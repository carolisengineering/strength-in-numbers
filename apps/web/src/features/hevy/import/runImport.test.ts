import { afterEach, describe, expect, it, vi } from "vitest";
import type { HevyImportBatch, HevyImportResult, HevyImportWorkout } from "@sin/core";

import { fakeImportApi, makeImportWorkout, testApiClient } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createHevyImportClient } from "./hevyImportClient";
import { resetImportLaneForTests } from "./importLane";
import { runBatches, runImport, type RunEvents, type StopReason } from "./runImport";

afterEach(() => resetImportLaneForTests());

/** `n` request workouts, newest first, one a day back from 2026-10-28. */
const workouts = (n: number, prefix = "w"): HevyImportWorkout[] =>
  Array.from({ length: n }, (_, i) => makeImportWorkout(`${prefix}${String(i).padStart(3, "0")}`, new Date(Date.parse("2026-10-28T09:00:00Z") - i * 86_400_000).toISOString()));

const chunk = (list: HevyImportWorkout[], size = 25) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

interface Recorded {
  done: { index: number; results: HevyImportResult[]; first: string }[];
  paused: { index: number; reason: string }[];
  stopped: { index: number; reason: StopReason }[];
  ended: number;
}

function harness(options: Parameters<typeof fakeImportApi>[0] = {}) {
  const fake = fakeImportApi(options);
  server.use(...fake.handlers);
  const client = createHevyImportClient(testApiClient());
  const waits: number[] = [];
  const unmount = new AbortController();
  const stop = new AbortController();
  let stopFlag = false;
  const rec: Recorded = { done: [], paused: [], stopped: [], ended: 0 };
  const events: RunEvents = {
    batchDone: (index, results, first) => rec.done.push({ index, results, first }),
    paused: (index, reason) => rec.paused.push({ index, reason }),
    stopped: (index, reason) => rec.stopped.push({ index, reason }),
    ended: () => {
      rec.ended += 1;
    },
  };
  const deps = {
    importBatch: (body: HevyImportBatch, signal?: AbortSignal) => client.importBatch(body, signal),
    sleep: async (ms: number, signal: AbortSignal) => {
      waits.push(ms);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    },
    signal: unmount.signal,
    stopSignal: stop.signal,
    shouldStop: () => stopFlag,
  };
  return {
    fake,
    waits,
    rec,
    events,
    deps,
    unmount,
    stop: () => {
      stopFlag = true;
      stop.abort();
    },
    bodies: () => fake.log.filter((r) => r.path === "/v1/hevy/import/workouts").map((r) => r.body as HevyImportBatch),
  };
}

describe("20.1 AC16 — the run", () => {
  it("sends every batch with dryRun: false, newest first, and reports each once with its first start time", async () => {
    const h = harness();
    const list = workouts(60);
    await runImport(h.deps, chunk(list), 0, h.events);
    expect(h.bodies().map((b) => b.workouts.length)).toEqual([25, 25, 10]);
    expect(h.bodies().every((b) => b.dryRun === false)).toBe(true);
    expect(h.bodies()[0]!.workouts[0]!.hevyWorkoutId).toBe("w000");
    expect(h.rec.done.map((d) => [d.index, d.results.length, d.first])).toEqual([
      [0, 25, list[0]!.startTime],
      [1, 25, list[25]!.startTime],
      [2, 10, list[50]!.startTime],
    ]);
    expect(h.rec.ended).toBe(1);
  });

  it("runBatches sends only create and duplicate, newest first, and skips an unreadable one (defended)", () => {
    const hevy = (id: string, start: string, type = "normal") => ({
      id,
      title: id,
      start_time: start,
      end_time: start,
      exercises: [{ index: 0, title: "Bench", exercise_template_id: "T1", sets: [{ index: 0, type, weight_kg: 50, reps: 5 }] }],
    });
    const read = new Map(
      [hevy("old", "2026-01-01T09:00:00Z"), hevy("new", "2026-09-01T09:00:00Z"), hevy("dup", "2026-05-01T09:00:00Z"), hevy("skip", "2026-06-01T09:00:00Z"), hevy("odd", "2026-07-01T09:00:00Z", "mystery")].map((w) => [w.id, w]),
    );
    const result = (id: string, outcome: HevyImportResult["outcome"]): HevyImportResult => ({
      hevyWorkoutId: id,
      outcome,
      workoutId: null,
      matchedWorkoutId: null,
      unpaired: [],
      drops: [],
      notices: [],
      exerciseCount: 1,
      setCount: 1,
    });
    const batches = runBatches(
      [result("old", "create"), result("new", "create"), result("dup", "duplicate"), result("skip", "already_imported"), result("odd", "create")],
      read as never,
      "UTC",
    );
    expect(batches.flat().map((w) => w.hevyWorkoutId)).toEqual(["new", "dup", "old"]);
  });
});

describe("20.1 AC17 — accumulation", () => {
  it("passes each batch's real results through, so a create the server already holds counts as already_imported", async () => {
    const h = harness({ outcomeFor: (id) => (id === "w001" ? "already_imported" : undefined) });
    await runImport(h.deps, chunk(workouts(3)), 0, h.events);
    expect(h.rec.done[0]!.results.map((r) => r.outcome)).toEqual(["create", "already_imported", "create"]);
  });

  it("the batch results add up to what was sent", async () => {
    const h = harness();
    await runImport(h.deps, chunk(workouts(51)), 0, h.events);
    expect(h.rec.done.reduce((n, d) => n + d.results.length, 0)).toBe(51);
  });
});

describe("20.1 AC18 — pace", () => {
  it("waits 250 ms between batches and never before the first", async () => {
    const h = harness();
    await runImport(h.deps, chunk(workouts(60)), 0, h.events);
    expect(h.waits).toEqual([250, 250]);
  });

  it("a 429 waits Retry-After and sends the same batch again, without counting as a retry", async () => {
    const h = harness();
    h.fake.failNext(429);
    await runImport(h.deps, chunk(workouts(3), 1), 0, h.events);
    expect(h.waits).toEqual([2000, 250, 250]);
    expect(h.bodies()[1]).toEqual(h.bodies()[0]);
    expect(h.rec.done).toHaveLength(3);
  });

  it("never has two requests in flight", async () => {
    const h = harness({ delayMs: 5 });
    await runImport(h.deps, chunk(workouts(4), 1), 0, h.events);
    expect(h.fake.concurrency.maxInFlight).toBe(1);
  });
});

describe("20.1 AC19 — retries and pause", () => {
  it("a network error or 5xx is re-sent after 2 s, 4 s and 8 s, then the run continues", async () => {
    const h = harness();
    h.fake.failSequence([503, "network", 503]);
    await runImport(h.deps, chunk(workouts(2), 1), 0, h.events);
    expect(h.waits).toEqual([2000, 4000, 8000, 250]);
    expect(h.rec.done).toHaveLength(2);
    expect(h.rec.paused).toEqual([]);
  });

  it("a fourth failure pauses at that batch; resuming from it re-sends it and the server answers already_imported", async () => {
    const h = harness({ delayMs: 0 });
    const batches = chunk(workouts(3), 1);
    h.fake.failSequence([500, 500, 500, 500]);
    await runImport(h.deps, batches, 0, h.events);
    expect(h.rec.paused).toEqual([{ index: 0, reason: "unreachable" }]);
    expect(h.rec.done).toEqual([]);
    expect(h.rec.ended).toBe(0);

    // The first batch landed on the server but its reply was lost: the resume's answer is already_imported.
    h.fake.links.set("w000", "imported");
    await runImport(h.deps, batches, 0, h.events);
    expect(h.rec.done.map((d) => d.results[0]!.outcome)).toEqual(["already_imported", "create", "create"]);
    expect([...h.fake.links.keys()].filter((id) => id === "w000")).toHaveLength(1);
  });

  it("a 422 stops with the batch's first error path", async () => {
    const h = harness();
    h.fake.failSequence([{ status: 422, path: "workouts.3.startTime" }]);
    await runImport(h.deps, chunk(workouts(2), 1), 0, h.events);
    expect(h.rec.stopped).toEqual([{ index: 0, reason: { kind: "invalid", path: "workouts.3.startTime" } }]);
    expect(h.rec.ended).toBe(0);
  });

  it("a 404 stops with gate", async () => {
    const h = harness();
    h.fake.failSequence([404]);
    await runImport(h.deps, chunk(workouts(2), 1), 0, h.events);
    expect(h.rec.stopped).toEqual([{ index: 0, reason: { kind: "gate" } }]);
  });

  it("a 401 stops with auth", async () => {
    const h = harness();
    h.fake.failSequence([401, 401]);
    await runImport(h.deps, chunk(workouts(2), 1), 0, h.events);
    expect(h.rec.stopped).toEqual([{ index: 0, reason: { kind: "auth" } }]);
  });

  it("any other 4xx (a 413) stops with invalid and an empty path (O3)", async () => {
    const h = harness();
    h.fake.failSequence([413]);
    await runImport(h.deps, chunk(workouts(2), 1), 1, h.events);
    expect(h.rec.stopped).toEqual([{ index: 1, reason: { kind: "invalid", path: "" } }]);
  });

  it("a reply that isn't understood stops with invalid and an empty path", async () => {
    const h = harness();
    h.fake.failNext("short");
    await runImport(h.deps, chunk(workouts(2), 2), 0, h.events);
    expect(h.rec.stopped).toEqual([{ index: 0, reason: { kind: "invalid", path: "" } }]);
  });
});

describe("20.1 AC20 — stop", () => {
  it("a Stop during batch 3 lets it finish, then stops before the next", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      importBatch: async (body: HevyImportBatch, signal?: AbortSignal) => {
        const reply = await h.deps.importBatch(body, signal);
        if (body.workouts[0]!.hevyWorkoutId === "w002") h.stop();
        return reply;
      },
    };
    await runImport(deps, chunk(workouts(5), 1), 0, h.events);
    expect(h.rec.done.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(h.rec.stopped).toEqual([{ index: 3, reason: { kind: "user" } }]);
    expect(h.bodies()).toHaveLength(3);
    expect(h.rec.ended).toBe(0);
  });

  it("final review I1: a Stop during the last batch still ends in stopped, never ended", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      importBatch: async (body: HevyImportBatch, signal?: AbortSignal) => {
        const reply = await h.deps.importBatch(body, signal);
        h.stop();
        return reply;
      },
    };
    await runImport(deps, chunk(workouts(3)), 0, h.events);
    expect(h.rec.done.map((d) => d.index)).toEqual([0]);
    expect(h.rec.stopped).toEqual([{ index: 1, reason: { kind: "user" } }]);
    expect(h.rec.ended).toBe(0);
  });

  it("a Stop during a 429 wait ends the run at once without re-sending (Review Focus 1)", async () => {
    const h = harness();
    h.fake.failNext(429);
    let release: () => void = () => {};
    const deps = {
      ...h.deps,
      sleep: (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          h.waits.push(ms);
          release = resolve;
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
    };
    const run = runImport(deps, chunk(workouts(2), 1), 0, h.events);
    await vi.waitFor(() => expect(h.waits).toEqual([2000]));
    h.stop();
    await run;
    release();
    expect(h.rec.stopped).toEqual([{ index: 0, reason: { kind: "user" } }]);
    expect(h.bodies()).toHaveLength(1);
    expect(h.rec.done).toEqual([]);
  });

  it("an unmount while batch 2 is in flight lets its request complete and reports nothing", async () => {
    const h = harness({ delayMs: 20 });
    const deps = {
      ...h.deps,
      importBatch: (body: HevyImportBatch, signal?: AbortSignal) => {
        expect(signal).toBeUndefined();
        const sent = h.deps.importBatch(body, signal);
        if (body.workouts[0]!.hevyWorkoutId === "w001") h.unmount.abort();
        return sent;
      },
    };
    await runImport(deps, chunk(workouts(3), 1), 0, h.events);
    expect(h.rec.done.map((d) => d.index)).toEqual([0]);
    expect(h.rec.stopped).toEqual([]);
    expect(h.rec.ended).toBe(0);
    await vi.waitFor(() => expect(h.fake.links.has("w001")).toBe(true));
    expect(h.bodies()).toHaveLength(2);
  });
});

describe("20.1 Review Focus 3 — a slow, out-of-order clock", () => {
  it("still sends each batch exactly once, in order", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, (ms % 7) + Math.floor(Math.random() * 5))),
    };
    await runImport(deps, chunk(workouts(6), 1), 0, h.events);
    expect(h.bodies().map((b) => b.workouts[0]!.hevyWorkoutId)).toEqual(["w000", "w001", "w002", "w003", "w004", "w005"]);
    expect(h.rec.done.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("minor 254 — the run leaves no listeners behind", () => {
  it("every abort listener the run adds to the per-mount and Stop signals is removed when it returns", async () => {
    const h = harness();
    const listeners = (signal: AbortSignal) => {
      const add = vi.spyOn(signal, "addEventListener");
      const remove = vi.spyOn(signal, "removeEventListener");
      return () => ({ added: add.mock.calls.length, removed: remove.mock.calls.length });
    };
    const mount = listeners(h.deps.signal);
    const stop = listeners(h.deps.stopSignal);
    await runImport(h.deps, chunk(workouts(30)), 0, h.events);
    expect(h.rec.ended).toBe(1);
    expect(mount()).toEqual({ added: 1, removed: 1 });
    expect(stop()).toEqual({ added: 1, removed: 1 });
  });
});
