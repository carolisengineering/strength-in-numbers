import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SetEntry } from "@sin/core";
import { ApiError } from "../../../api";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet } from "../../../test/workoutFixtures";
import { deferred } from "../../../test/workoutHarness";
import { createOutbox, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const KEY3 = "30000000-0000-4000-8000-000000000003";
const SERVER = "40000000-0000-4000-8000-000000000001";
const body = (key = KEY, reps = 8) => ({ clientGeneratedId: key, weight: 60, weightUnit: "kg" as const, reps, isComplete: true });
const network = () => ApiError.network("r", new TypeError("Failed to fetch"));
const api = (status: number, slug = "about:blank") =>
  new ApiError({ status, type: slug === "about:blank" ? slug : `https://x/problems/${slug}`, title: "t", requestId: "req" });

function setup(over: Partial<OutboxDeps> = {}) {
  let online = true;
  const rest = {
    createSet: vi.fn(async (_we: string, b: { clientGeneratedId?: string; reps?: number | null }): Promise<SetEntry> =>
      makeSet({ id: SERVER, clientGeneratedId: b.clientGeneratedId ?? null, reps: b.reps ?? 8 }),
    ),
    updateSet: vi.fn(async (id: string, b: { reps?: number | null }): Promise<SetEntry> => makeSet({ id, reps: b.reps ?? 8 })),
    deleteSet: vi.fn(async (): Promise<void> => undefined),
  };
  const onSynced = vi.fn();
  const onFailed = vi.fn();
  const outbox = createOutbox({
    storage: memoryStorageAdapter(),
    rest,
    userId: "u1",
    isOnline: () => online,
    random: () => 0.5,
    onSynced,
    onFailed,
    ...over,
  });
  const stop = outbox.start();
  return {
    outbox,
    rest,
    onSynced,
    onFailed,
    stop,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
    },
  };
}
type Ctx = ReturnType<typeof setup>;
const add = (outbox: Ctx["outbox"], key = KEY, reps = 8) =>
  outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body(key, reps) });
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-10-03T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  observability.track.mockReset();
});

describe("06.2 AC4 — one op in flight, first in, first out", () => {
  it("the second op is not sent until the first settles", async () => {
    const gate = deferred<SetEntry>();
    const { outbox, rest } = setup();
    rest.createSet.mockImplementationOnce(() => gate.promise);
    add(outbox);
    add(outbox, KEY2);
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    gate.resolve(makeSet({ id: SERVER, clientGeneratedId: KEY }));
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(2);
    expect(rest.createSet.mock.calls.map(([, b]) => b.clientGeneratedId)).toEqual([KEY, KEY2]);
  });

  it("an update targeting a client key is sent to the server id learned when its create synced", async () => {
    const gate = deferred<SetEntry>();
    const { outbox, rest } = setup();
    rest.createSet.mockImplementationOnce(() => gate.promise);
    add(outbox);
    await settle(); // the create is now attempted (frozen)
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 9 } });
    gate.resolve(makeSet({ id: SERVER, clientGeneratedId: KEY }));
    await settle();
    expect(rest.updateSet).toHaveBeenCalledWith(SERVER, { reps: 9 });
    expect(outbox.getState().idMap[KEY]).toEqual({ setId: SERVER, workoutId: "w" });
  });

  it("targetFor a synced client key returns the server id (Review Focus 1)", async () => {
    const { outbox } = setup();
    add(outbox);
    await settle();
    expect(outbox.getState().ops).toEqual([]);
    expect(outbox.targetFor(KEY)).toEqual({ setId: SERVER });
  });

  it("ops of a create that failed permanently fail with it, unsent", async () => {
    const gate = deferred<SetEntry>();
    const { outbox, rest } = setup();
    rest.createSet.mockImplementationOnce(() => gate.promise);
    add(outbox);
    await settle(); // the create is in flight, so the edit is appended, not merged
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 9 } });
    gate.reject(api(422, "validation-error"));
    await settle();
    expect(outbox.getState().ops.map((o) => [o.kind, o.status])).toEqual([
      ["create", "failed"],
      ["update", "failed"],
    ]);
    expect(rest.updateSet).not.toHaveBeenCalled();
  });

  it("an op whose client key never resolves fails instead of sending a bad id", async () => {
    const { outbox, rest, onFailed } = setup();
    outbox.enqueueDelete({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY } });
    await settle();
    expect(rest.deleteSet).not.toHaveBeenCalled();
    expect(outbox.getState().ops[0]).toMatchObject({ status: "failed", failure: { type: "unresolved" } });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});

describe("06.2 AC3 — lost response, then an edit: the server ends at the edited value", () => {
  it("replays the POST then sends the PATCH", async () => {
    const { outbox, rest } = setup();
    rest.createSet.mockRejectedValueOnce(network()); // applied server-side, response lost
    add(outbox, KEY, 8);
    await settle();
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 9 } });
    expect(outbox.getState().ops.map((o) => o.kind)).toEqual(["create", "update"]); // frozen, not merged
    outbox.retryNow();
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(2);
    expect(rest.createSet.mock.calls[1]![1]).toMatchObject({ clientGeneratedId: KEY, reps: 8 });
    expect(rest.updateSet).toHaveBeenCalledWith(SERVER, { reps: 9 });
    expect(outbox.getState().ops).toEqual([]);
  });
});

describe("06.2 AC5 — retry with backoff; permanent failures stop", () => {
  it("retryable failures back off 1 s, 2 s, then succeed; a waiting head blocks later ops (Review Focus 4)", async () => {
    const { outbox, rest } = setup();
    rest.createSet.mockRejectedValueOnce(api(503)).mockRejectedValueOnce(network());
    add(outbox);
    add(outbox, KEY2);
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rest.createSet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rest.createSet).toHaveBeenCalledTimes(4); // KEY succeeds on attempt 3, then KEY2
    expect(rest.createSet.mock.calls.map(([, b]) => b.clientGeneratedId)).toEqual([KEY, KEY, KEY, KEY2]);
  });

  it("a delete answered 404 is done", async () => {
    const { outbox, rest, onSynced } = setup();
    rest.deleteSet.mockRejectedValueOnce(api(404, "not-found"));
    outbox.enqueueDelete({ workoutId: "w", workoutExerciseId: "we", target: { setId: SERVER } });
    await settle();
    expect(outbox.getState().ops).toEqual([]);
    expect(onSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "delete" }), null);
  });

  it("409 workout-finished fails that op and every later op of the workout, once each in telemetry (06.2 AC17, 06.2 AC18)", async () => {
    const { outbox, rest, onFailed } = setup();
    rest.createSet.mockRejectedValueOnce(api(409, "workout-finished"));
    add(outbox);
    add(outbox, KEY2);
    outbox.enqueueCreate({ workoutId: "other", workoutExerciseId: "we2", body: body(KEY3) });
    await settle();
    const ofW = outbox.getState().ops.filter((o) => o.workoutId === "w");
    expect(ofW.map((o) => [o.status, o.failure?.type])).toEqual([
      ["failed", "workout-finished"],
      ["failed", "workout-finished"],
    ]);
    // The other workout's op is untouched by the cascade (it is sent next and may already be gone).
    expect(outbox.getState().ops.filter((o) => o.workoutId === "other" && o.status === "failed")).toEqual([]);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toEqual([
      ["set_sync_failed", { status: 409 }],
      ["set_sync_failed", { status: 409 }],
    ]);
  });

  it("06.2 AC18 — a slow sync (> 2 s) tracks set_sync_delayed with the duration only; a fast one does not", async () => {
    const { outbox, rest } = setup();
    add(outbox, KEY2);
    await settle();
    expect(observability.track).not.toHaveBeenCalledWith("set_sync_delayed", expect.anything());
    rest.createSet.mockRejectedValueOnce(network()).mockRejectedValueOnce(network());
    add(outbox);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(observability.track).toHaveBeenCalledWith("set_sync_delayed", { ms: 3000 });
  });
});

describe("06.2 AC6 — drain triggers", () => {
  it("offline: an enqueue stores but sends nothing; the online event drains", async () => {
    const { outbox, rest, goOffline, goOnline } = setup();
    goOffline();
    add(outbox);
    await settle();
    expect(rest.createSet).not.toHaveBeenCalled();
    goOnline();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(1);
  });

  it("offline: no retry timer fires; Retry now makes exactly one attempt", async () => {
    const { outbox, rest, goOffline } = setup();
    rest.createSet.mockRejectedValue(network());
    add(outbox);
    await settle();
    goOffline();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    outbox.retryNow();
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(2);
  });

  it("becoming visible drains; online / offline events update state.online", async () => {
    const { outbox, rest, goOffline, goOnline } = setup();
    goOffline();
    window.dispatchEvent(new Event("offline"));
    expect(outbox.getState().online).toBe(false);
    add(outbox);
    goOnline();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(rest.createSet).toHaveBeenCalledTimes(1);
  });

  it("stop() removes the listeners and the timer", async () => {
    const { outbox, rest, stop, goOffline, goOnline } = setup();
    goOffline();
    add(outbox);
    stop();
    goOnline();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(rest.createSet).not.toHaveBeenCalled();
  });
});
