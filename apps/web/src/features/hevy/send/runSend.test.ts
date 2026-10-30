import { describe, expect, it } from "vitest";
import { buildHevyWorkout, type HevyMapping, type HevyPostWorkout, type WorkoutDetail } from "@sin/core";

import { VALID_KEY } from "../../../test/hevyHarness";
import { ApiError } from "../../../api";
import { HevyError } from "../client/hevyErrors";
import { fakeHevyLink, fakeHevyWrites, hevyFingerprintOf, networkError, sendFixture, WORKOUT_ID } from "../../../test/hevySendFakes";
import { problemSentence, runSend, type SendDeps, type SendIntent, type SendOutcome } from "./runSend";

const rootOf = (id: string) => id;

function harness(opts: { detail?: WorkoutDetail; mapping?: HevyMapping; now?: () => number } = {}) {
  const fixture = sendFixture();
  let detail = opts.detail ?? fixture.detail;
  const mapping = opts.mapping ?? fixture.mapping;
  const link = fakeHevyLink({ detailOf: (id) => (id === WORKOUT_ID ? detail : null), ...(opts.now ? { now: opts.now } : {}) });
  const hevy = fakeHevyWrites();
  const order: string[] = [];
  const waits: number[] = [];
  const reports: [string, unknown][] = [];
  const api = {
    post: (...a: Parameters<typeof link.api.post>) => (order.push("begin"), link.api.post(...a)),
    request: (...a: Parameters<typeof link.api.request>) => (order.push("complete"), link.api.request(...a)),
    delete: (...a: Parameters<typeof link.api.delete>) => (order.push("release"), link.api.delete(...a)),
  };
  const client = {
    createWorkout: (b: HevyPostWorkout) => (order.push("hevy-post"), hevy.client.createWorkout(b)),
    updateWorkout: (id: string, b: HevyPostWorkout) => (order.push("hevy-put"), hevy.client.updateWorkout(id, b)),
    listWorkouts: (p: number) => (order.push("hevy-list"), hevy.client.listWorkouts(p)),
  };
  const deps = (over: Partial<SendDeps> = {}): SendDeps => ({
    workoutId: WORKOUT_ID,
    getDetail: async () => (order.push("detail"), detail),
    getMapping: async () => (order.push("mapping"), mapping),
    rootOf,
    hevy: client,
    api: api as unknown as SendDeps["api"],
    sleep: async (ms) => void waits.push(ms),
    report: (op, e) => void reports.push([op, e]),
    ...over,
  });
  const run = (intent: SendIntent, over: Partial<SendDeps> = {}) => runSend(intent, deps(over));
  return {
    run,
    link,
    hevy,
    order,
    waits,
    reports,
    mapping,
    get detail() {
      return detail;
    },
    setDetail: (d: WorkoutDetail) => void (detail = d),
  };
}

const kind = (o: SendOutcome) => o.kind;

describe("20.2 AC4 — send call order and body", () => {
  it("reads, begins, posts the built body, completes with begin's fingerprint; the key never reaches the API", async () => {
    const h = harness();
    const outcome = await h.run({ kind: "send" });
    expect(outcome).toMatchObject({ kind: "done", foundExisting: false });
    expect(h.order).toEqual(["detail", "mapping", "begin", "hevy-post", "complete"]);
    const built = buildHevyWorkout(h.detail, h.mapping, { rootOf });
    expect(built.ok && h.hevy.calls[0]!.body).toEqual(built.ok ? built.body : null);
    expect((h.hevy.calls[0]!.body as HevyPostWorkout).workout.is_private).toBe(true);
    const put = h.link.log.find((r) => r.method === "PUT")!;
    expect(put.body).toEqual({ hevyWorkoutId: "h1", fingerprint: hevyFingerprintOf(h.detail) });
    expect(JSON.stringify(h.link.log)).not.toContain(VALID_KEY);
    expect(h.link.read(WORKOUT_ID).state).toBe("sent");
  });
});

describe("20.2 AC6 — another send in progress", () => {
  it("a fresh claim answers in-progress and nothing goes to Hevy", async () => {
    const h = harness();
    h.link.claim(WORKOUT_ID, 10_000);
    expect(await h.run({ kind: "send" })).toEqual({ kind: "in-progress" });
    expect(h.hevy.calls).toEqual([]);
  });
});

describe("20.2 AC7 — stale claim", () => {
  const stale = () => {
    const h = harness();
    h.link.claim(WORKOUT_ID, 5 * 60_000);
    return h;
  };

  it("a copy already in Hevy is found: no POST, complete with its id", async () => {
    const h = stale();
    const built = buildHevyWorkout(h.detail, h.mapping, { rootOf });
    await h.hevy.client.createWorkout(built.ok ? built.body : (null as never));
    h.hevy.calls.length = 0;
    const outcome = await h.run({ kind: "send" });
    expect(outcome).toMatchObject({ kind: "done", foundExisting: true });
    expect(h.hevy.writes()).toEqual([]);
    expect(h.link.read(WORKOUT_ID)).toMatchObject({ state: "sent", hevyWorkoutId: "h1" });
  });

  it("conclusively not found: one POST", async () => {
    const h = stale();
    expect(kind(await h.run({ kind: "send" }))).toBe("done");
    expect(h.hevy.writes()).toHaveLength(1);
  });

  it("inconclusive: no POST and the claim is kept; Send anyway posts once without scanning", async () => {
    const h = stale();
    for (let i = 0; i < 60; i += 1) await h.hevy.client.createWorkout({ workout: { title: `Later ${i}`, description: null, start_time: "2026-10-28T10:00:00Z", end_time: "2026-10-28T11:00:00Z", is_private: true, exercises: [] } } as never);
    h.hevy.calls.length = 0;
    const outcome = await h.run({ kind: "send" });
    expect(outcome).toMatchObject({ kind: "inconclusive" });
    expect(h.hevy.writes()).toEqual([]);
    expect(h.link.rows.get(WORKOUT_ID)!.claimedAt).not.toBeNull();
    const fingerprint = (outcome as { fingerprint: string }).fingerprint;
    h.hevy.calls.length = 0;
    expect(kind(await h.run({ kind: "send-anyway", fingerprint }))).toBe("done");
    expect(h.hevy.calls.map((c) => c.op)).toEqual(["create"]);
  });

  it("a stale claim on a linked workout updates without scanning", async () => {
    const h = stale();
    h.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    h.hevy.store.set("h9", { id: "h9", title: "x", start_time: "2026-10-24T17:05:00Z", end_time: "2026-10-24T18:00:00Z", exercises: [] });
    h.link.rows.set(WORKOUT_ID, { ...h.link.rows.get(WORKOUT_ID)!, claimedAt: Date.now() - 5 * 60_000 });
    expect(kind(await h.run({ kind: "update" }))).toBe("done");
    expect(h.hevy.calls.map((c) => c.op)).toEqual(["update"]);
  });
});

describe("20.2 AC8 — definite failures release", () => {
  it.each([
    ["400", "rejected"],
    ["403-limit", "limit"],
    ["403", "bad_key"],
    // Owner answer Q2 (2026-10-30): a Hevy 429, or a 404 on a create, is definite too.
    ["429", "rate_limited"],
    ["404", "not_found"],
  ] as const)("%s → failed:%s, one release, no claim left", async (mode, reason) => {
    const h = harness();
    h.hevy.fail("create", mode);
    expect(await h.run({ kind: "send" })).toEqual({ kind: "failed", reason });
    expect(h.order.filter((o) => o === "release")).toHaveLength(1);
    expect(h.link.rows.has(WORKOUT_ID)).toBe(false);
  });
});

describe("20.2 AC9 — ambiguous failures keep the claim", () => {
  it.each(["network", "5xx", "accept-then-lose"] as const)("%s → unsure, no release, no second POST", async (mode) => {
    const h = harness();
    h.hevy.fail("create", mode);
    const outcome = await h.run({ kind: "send" });
    expect(outcome).toMatchObject({ kind: "unsure", op: "post" });
    expect(h.order).not.toContain("release");
    expect(h.hevy.writes()).toHaveLength(1);
    expect(h.link.rows.get(WORKOUT_ID)!.claimedAt).not.toBeNull();
  });

  it("Check Hevy: found → done (no begin, no write)", async () => {
    const h = harness();
    h.hevy.fail("create", "accept-then-lose");
    const unsure = (await h.run({ kind: "send" })) as Extract<SendOutcome, { kind: "unsure" }>;
    h.order.length = 0;
    expect(await h.run({ kind: "check", fingerprint: unsure.fingerprint })).toMatchObject({ kind: "done", foundExisting: true });
    expect(h.order).not.toContain("begin");
    expect(h.hevy.writes()).toHaveLength(1);
    expect(h.link.read(WORKOUT_ID).state).toBe("sent");
  });

  it("Check Hevy: conclusively not found → release, not-sent", async () => {
    const h = harness();
    h.hevy.fail("create", "network");
    const unsure = (await h.run({ kind: "send" })) as Extract<SendOutcome, { kind: "unsure" }>;
    expect(await h.run({ kind: "check", fingerprint: unsure.fingerprint })).toEqual({ kind: "not-sent" });
    expect(h.link.rows.has(WORKOUT_ID)).toBe(false);
  });
});

describe("20.2 AC10 — complete retries and its conflicts", () => {
  it("four failures wait 1 s, 2 s, 4 s, then unrecorded; Try again only completes", async () => {
    const h = harness();
    h.link.fail("complete", "network", 503, 503, "network");
    const outcome = await h.run({ kind: "send" });
    expect(outcome).toEqual({ kind: "unrecorded", hevyWorkoutId: "h1", fingerprint: hevyFingerprintOf(h.detail) });
    expect(h.waits).toEqual([1000, 2000, 4000]);
    h.order.length = 0;
    h.hevy.calls.length = 0;
    const retry = outcome as Extract<SendOutcome, { kind: "unrecorded" }>;
    expect(kind(await h.run({ kind: "retry-complete", hevyWorkoutId: retry.hevyWorkoutId, fingerprint: retry.fingerprint }))).toBe("done");
    expect(h.order).toEqual(["complete"]);
    expect(h.hevy.calls).toEqual([]);
  });

  it("after a reload (the held id lost, the claim stale), Send finds the copy instead of posting again", async () => {
    let clock = Date.now();
    const h = harness({ now: () => clock });
    h.link.fail("complete", "network", "network", "network", "network");
    await h.run({ kind: "send" });
    clock += 5 * 60_000;
    h.hevy.calls.length = 0;
    expect(await h.run({ kind: "send" })).toMatchObject({ kind: "done", foundExisting: true });
    expect(h.hevy.writes()).toEqual([]);
  });

  it.each(["hevy-id-in-use", "hevy-link-conflict"])("409 %s → already-linked, the claim kept", async (slug) => {
    const h = harness();
    h.link.fail("complete", { status: 409, slug });
    expect(await h.run({ kind: "send" })).toEqual({ kind: "already-linked" });
    expect(h.order).not.toContain("release");
  });

  it("409 hevy-no-claim → refused", async () => {
    const h = harness();
    h.link.fail("complete", { status: 409, slug: "hevy-no-claim" });
    expect(await h.run({ kind: "send" })).toEqual({ kind: "refused", slug: "hevy-no-claim" });
  });
});

describe("20.2 AC11 — update", () => {
  const linked = () => {
    const h = harness();
    h.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    h.hevy.store.set("h9", { id: "h9", title: "Push A", start_time: "2026-10-24T17:05:00Z", end_time: "2026-10-24T18:00:00Z", exercises: [] });
    return h;
  };

  it("PUTs the rebuilt body to the stored id, completes, and reads sent", async () => {
    const h = linked();
    expect(h.link.read(WORKOUT_ID).state).toBe("changed");
    expect(kind(await h.run({ kind: "update" }))).toBe("done");
    expect(h.hevy.calls.map((c) => [c.op, c.id])).toEqual([["update", "h9"]]);
    const built = buildHevyWorkout(h.detail, h.mapping, { rootOf });
    expect(h.hevy.calls[0]!.body).toEqual(built.ok ? built.body : null);
    expect(h.link.read(WORKOUT_ID).state).toBe("sent");
  });

  it("an ambiguous PUT is unsure:put; Try again repeats the PUT", async () => {
    const h = linked();
    h.hevy.fail("update", "5xx");
    const unsure = (await h.run({ kind: "update" })) as Extract<SendOutcome, { kind: "unsure" }>;
    expect(unsure).toMatchObject({ kind: "unsure", op: "put", hevyWorkoutId: "h9" });
    expect(kind(await h.run({ kind: "retry-update", hevyWorkoutId: "h9", fingerprint: unsure.fingerprint }))).toBe("done");
    expect(h.hevy.calls.map((c) => c.op)).toEqual(["update", "update"]);
  });
});

describe("20.2 AC12 — copy deleted in Hevy", () => {
  it("a 404 on the PUT releases and answers copy-gone; relink begins with { relink: true } and posts", async () => {
    const h = harness();
    h.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    expect(await h.run({ kind: "update" })).toEqual({ kind: "copy-gone" });
    expect(h.order).toContain("release");
    expect(kind(await h.run({ kind: "relink" }))).toBe("done");
    expect(h.link.log.filter((r) => r.method === "POST").at(-1)!.body).toEqual({ relink: true });
    expect(h.hevy.calls.map((c) => c.op)).toEqual(["update", "create"]);
    expect(h.link.read(WORKOUT_ID)).toMatchObject({ state: "sent", hevyWorkoutId: "h1" });
  });
});

describe("20.2 AC16 — offline", () => {
  it("a network failure on begin is failed:network, with no claim and no Hevy call", async () => {
    const h = harness();
    h.link.fail("begin", "network");
    expect(await h.run({ kind: "send" })).toEqual({ kind: "failed", reason: "network" });
    expect(h.link.rows.has(WORKOUT_ID)).toBe(false);
    expect(h.hevy.calls).toEqual([]);
  });

  it("Review Focus 4: the mapping can't be read → failed:network, no API call at all", async () => {
    const h = harness();
    const outcome = await h.run({ kind: "send" }, { getMapping: async () => Promise.reject(networkError()) });
    expect(outcome).toEqual({ kind: "failed", reason: "network" });
    expect(h.link.log).toEqual([]);
    expect(h.hevy.calls).toEqual([]);
  });
});

describe("20.2 AC20 — reporting", () => {
  it("a Hevy 5xx is reported once as hevy-post; network and 400 never are", async () => {
    const a = harness();
    a.hevy.fail("create", "5xx");
    await a.run({ kind: "send" });
    expect(a.reports.map(([op]) => op)).toEqual(["hevy-post"]);
    const b = harness();
    b.hevy.fail("create", "network");
    await b.run({ kind: "send" });
    const c = harness();
    c.hevy.fail("create", "400");
    await c.run({ kind: "send" });
    expect([...b.reports, ...c.reports]).toEqual([]);
  });

  it("an unreadable Hevy reply (on a 2xx) is reported as hevy-post", async () => {
    const h = harness();
    const deps = { createWorkout: async () => Promise.reject(new HevyError("unexpected_reply", { status: 200 })) };
    const outcome = await h.run({ kind: "send" }, { hevy: { ...deps, updateWorkout: h.hevy.client.updateWorkout, listWorkouts: h.hevy.client.listWorkouts } });
    expect(outcome).toMatchObject({ kind: "unsure", op: "post" });
    expect(h.reports.map(([op]) => op)).toEqual(["hevy-post"]);
  });

  it("complete is reported after its last retry on a 500", async () => {
    const h = harness();
    h.link.fail("complete", 500, 500, 500, 500);
    expect(kind(await h.run({ kind: "send" }))).toBe("unrecorded");
    expect(h.reports.map(([op]) => op)).toEqual(["complete"]);
  });
});

describe("20.2 AC19 — every slug has a sentence", () => {
  it("the five slugs read; an unknown one is null", () => {
    for (const slug of ["hevy-send-in-progress", "hevy-workout-not-finished", "hevy-no-claim", "hevy-link-conflict", "hevy-id-in-use"]) {
      expect(problemSentence(slug)).toMatch(/\S/);
    }
    expect(problemSentence("something-else")).toBeNull();
  });
});

describe("20.2 — a deleted workout", () => {
  it("begin 404 → gone, no Hevy call", async () => {
    const h = harness();
    h.link.fail("begin", { status: 404, slug: "not-found" });
    expect(await h.run({ kind: "send" })).toEqual({ kind: "gone" });
    expect(h.hevy.calls).toEqual([]);
  });

  it("complete 404 after the POST → gone, no retry", async () => {
    const h = harness();
    h.link.fail("complete", { status: 404, slug: "not-found" });
    expect(await h.run({ kind: "send" })).toEqual({ kind: "gone" });
    expect(h.waits).toEqual([]);
  });
});

describe("20.2 Review Focus 3 — a workout with no title", () => {
  it("the scan compares against the built title (the routine name), not detail.title", async () => {
    const h = harness({ detail: sendFixture({ title: null, routineName: "Leg Day" }).detail });
    h.link.claim(WORKOUT_ID, 5 * 60_000);
    await h.hevy.client.createWorkout({ workout: { title: "Leg Day", description: null, start_time: "2026-10-24T17:05:00+00:00", end_time: "2026-10-24T18:10:00Z", is_private: true, exercises: [] } } as never);
    h.hevy.calls.length = 0;
    expect(await h.run({ kind: "send" })).toMatchObject({ kind: "done", foundExisting: true });
  });
});

describe("20.2 code review — reads and complete", () => {
  it("a 404 reading the workout is gone; a 500 there is reported", async () => {
    const h = harness();
    const notFound = await h.run({ kind: "send" }, { getDetail: async () => Promise.reject(new ApiError({ status: 404, type: "x/not-found", title: "nf", requestId: "r" })) });
    expect(notFound).toEqual({ kind: "gone" });
    const boom = new ApiError({ status: 500, type: "x/internal", title: "boom", requestId: "r" });
    expect(await h.run({ kind: "send" }, { getMapping: async () => Promise.reject(boom) })).toEqual({ kind: "failed", reason: "server" });
    expect(h.reports).toEqual([["begin", boom]]);
  });

  it("a complete refused with another 4xx after Hevy wrote reads as unrecorded (the copy is in Hevy)", async () => {
    const h = harness();
    h.link.fail("complete", 422);
    expect(await h.run({ kind: "send" })).toEqual({ kind: "unrecorded", hevyWorkoutId: "h1", fingerprint: hevyFingerprintOf(h.detail) });
  });
});

describe("20.2 final review — an update that becomes a stale create scans first", () => {
  it("Update on a stale claim-only row finds the earlier copy instead of posting again", async () => {
    const h = harness();
    h.link.claim(WORKOUT_ID, 5 * 60_000);
    const built = buildHevyWorkout(h.detail, h.mapping, { rootOf });
    await h.hevy.client.createWorkout(built.ok ? built.body : (null as never));
    h.hevy.calls.length = 0;
    expect(await h.run({ kind: "update" })).toMatchObject({ kind: "done", foundExisting: true });
    expect(h.hevy.writes()).toEqual([]);
  });
});

describe("20.2 D6 / owner answer Q5 — create only", () => {
  it("when begin answers update, a create-only send releases and writes nothing", async () => {
    const h = harness();
    h.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    expect(await h.run({ kind: "send" }, { createOnly: true })).toEqual({ kind: "skipped", reason: "already_sent" });
    expect(h.hevy.calls).toEqual([]);
    expect(h.order).toContain("release");
    expect(h.link.rows.get(WORKOUT_ID)).toMatchObject({ hevyWorkoutId: "h9", claimedAt: null });
  });
});

describe("20.2 D2 — exercises left out", () => {
  it("drops them before building and adds a left_out notice per exercise", async () => {
    const h = harness();
    const exerciseId = h.detail.exercises[1]!.exerciseId;
    const outcome = await h.run({ kind: "send" }, { leaveOut: new Set([exerciseId]) });
    expect(outcome).toMatchObject({ kind: "done", notices: expect.arrayContaining([{ code: "left_out", name: "Row" }]) });
    expect((h.hevy.calls[0]!.body as HevyPostWorkout).workout.exercises).toHaveLength(1);
  });
});
