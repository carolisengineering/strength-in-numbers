import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SetEntry, UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { ApiError } from "../../../api";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import type { FinishMeta, FinishOp, OutboxOp } from "./ops";
import { createOutbox, outboxKey, SEND_TIMEOUT_MS, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const S1 = "40000000-0000-4000-8000-000000000001";
const ENDED = "2026-11-08T10:15:00.000Z";
const META: FinishMeta = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 2, setCount: 6, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const setBody = (key = KEY) => ({ clientGeneratedId: key, weight: 60, weightUnit: "kg" as const, reps: 8, isComplete: true });
const counter = () => {
  let i = 0;
  return () => `op-${++i}`;
};
const apiError = (status: number, slug = "") =>
  new ApiError({ status, type: slug ? `https://api.strengthinnumbers.app/problems/${slug}` : "about:blank", title: "t", requestId: `req-${status}` });
const network = () => ApiError.network("req-net", new TypeError("Failed to fetch"));

/** A REST fake whose calls wait until the test settles them, in call order. */
function fakeRest() {
  type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const queue: { method: string; args: unknown[]; p: Pending }[] = [];
  const hold =
    (method: string) =>
    (...args: unknown[]) =>
      new Promise<never>((resolve, reject) => {
        queue.push({ method, args, p: { resolve: resolve as (v: unknown) => void, reject } });
      });
  const rest = {
    createSet: vi.fn(hold("createSet")),
    updateSet: vi.fn(hold("updateSet")),
    deleteSet: vi.fn(hold("deleteSet")),
    setExerciseNote: vi.fn(hold("setExerciseNote")),
    putRoundTime: vi.fn(hold("putRoundTime")),
    deleteRoundTime: vi.fn(hold("deleteRoundTime")),
    putResult: vi.fn(hold("putResult")),
    deleteResult: vi.fn(hold("deleteResult")),
    finish: vi.fn(hold("finish")),
    getById: vi.fn(hold("getById")),
  };
  const next = (method?: string) => {
    const call = queue.shift();
    if (!call) throw new Error("no pending call");
    if (method && call.method !== method) throw new Error(`expected ${method}, got ${call.method}`);
    return call;
  };
  return {
    rest,
    calls: () => queue.map((c) => c.method),
    resolve: (method: string, value: unknown) => next(method).p.resolve(value),
    reject: (method: string, error: unknown) => next(method).p.reject(error),
  };
}

const updated = (endedAt = ENDED): UpdatedWorkout => ({ ...makeWorkoutDetail({ endedAt }), newRecords: [] }) as unknown as UpdatedWorkout;
const detail = (endedAt: string | null): WorkoutDetail => makeWorkoutDetail({ endedAt });

function setup(over: Partial<OutboxDeps> = {}) {
  const f = fakeRest();
  const onFinishSynced = vi.fn();
  const onFinishFailed = vi.fn();
  const onFailed = vi.fn();
  const onSynced = vi.fn();
  const storage = over.storage ?? memoryStorageAdapter();
  const outbox = createOutbox({
    storage,
    rest: f.rest,
    userId: "u1",
    isOnline: () => true,
    newId: counter(),
    random: () => 0.5,
    onFinishSynced,
    onFinishFailed,
    onFailed,
    onSynced,
    ...over,
  });
  return { ...f, outbox, onFinishSynced, onFinishFailed, onFailed, onSynced, storage };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const finishInput = (workoutId = "w") => ({ workoutId, body: { endedAt: ENDED }, meta: META });
const finishOf = (ops: readonly OutboxOp[]) => ops.find((o): o is FinishOp => o.kind === "finish");

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC2 — at most one finish per workout, and it sends last", () => {
  it("enqueueFinish returns the op's id; a second enqueue on a queued or sending finish adds nothing and returns the same id", async () => {
    const t = setup({ isOnline: () => false });
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ id, kind: "finish", workoutId: "w", userId: "u1", status: "queued", attempted: false, body: { endedAt: ENDED }, meta: META });
    expect(t.outbox.enqueueFinish({ ...finishInput(), body: { endedAt: "2026-11-08T10:20:00.000Z" } })).toBe(id);
    expect(t.outbox.getState().ops).toHaveLength(1);
    expect(finishOf(t.outbox.getState().ops)!.body.endedAt).toBe(ENDED);
  });

  it("while sending, a second enqueue still returns the existing id", async () => {
    const t = setup();
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    await flush();
    expect(finishOf(t.outbox.getState().ops)!.status).toBe("sending");
    expect(t.outbox.enqueueFinish(finishInput())).toBe(id);
    expect(t.outbox.getState().ops).toHaveLength(1);
  });

  it("on a failed finish, enqueueFinish replaces it with a fresh op at the end of the queue", async () => {
    let online = true;
    const t = setup({ isOnline: () => online });
    t.outbox.start();
    const first = t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "incomplete-working-sets"));
    await flush();
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ id: first, status: "failed" });
    online = false;
    const second = t.outbox.enqueueFinish({ ...finishInput(), body: { endedAt: "2026-11-08T10:20:00.000Z", keepRoutine: true } });
    expect(second).not.toBe(first);
    const ops = t.outbox.getState().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id: second, status: "queued", attempted: false, attempts: 0, body: { endedAt: "2026-11-08T10:20:00.000Z", keepRoutine: true } });
    expect(ops[0]!.failure).toBeUndefined();
  });

  it("the finish waits while another op of its workout is in the queue, then goes last", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    t.outbox.enqueueFinish(finishInput());
    await flush();
    expect(t.calls()).toEqual(["createSet"]);
    t.resolve("createSet", makeSet({ id: S1, clientGeneratedId: KEY }));
    await flush();
    expect(t.calls()).toEqual(["finish"]);
    expect(t.rest.finish).toHaveBeenCalledWith("w", { endedAt: ENDED }, { signal: expect.any(AbortSignal) });
  });

  it("the live-workout shortcut never picks a finish ahead of its workout's own ops", async () => {
    // The head (another workout) is backing off; the live workout has a set behind it and its finish.
    const t = setup({ activeWorkoutId: () => "w" });
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "old", workoutExerciseId: "we-old", body: setBody(KEY2) });
    await flush();
    t.reject("createSet", network());
    await flush();
    t.outbox.__setForTests([
      ...t.outbox.getState().ops,
      // A finish first, then a set: only reachable through a damaged file, but the drainer must still hold the finish.
      { id: "f", workoutId: "w", userId: "u1", status: "queued", attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0, kind: "finish", body: { endedAt: ENDED }, meta: META },
      { id: "c", workoutId: "w", workoutExerciseId: "we", userId: "u1", status: "queued", attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0, kind: "create", target: { clientGeneratedId: KEY }, body: setBody() },
    ]);
    void t.outbox.drain();
    await flush();
    expect(t.calls()).toEqual(["createSet"]);
    expect(t.rest.createSet).toHaveBeenLastCalledWith("we", setBody(), expect.anything());
    expect(t.rest.finish).not.toHaveBeenCalled();
  });

  it("an earlier failed op fails the finish with the same failure and blockedBy, once", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("createSet", apiError(422, "validation-error"));
    await flush();
    const ops = t.outbox.getState().ops;
    const create = ops.find((o) => o.kind === "create")!;
    expect(finishOf(ops)).toMatchObject({ status: "failed", failure: { status: 422, type: "validation-error", requestId: "req-422", blockedBy: create.id } });
    expect(t.rest.finish).not.toHaveBeenCalled();
    expect(t.onFinishFailed).toHaveBeenCalledTimes(1);
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_finish_failed")).toEqual([["workout_finish_failed", { status: 0 }]]);
    // The set's failure is still a set failure; the finish never is.
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toEqual([["set_sync_failed", { status: 422 }]]);
  });

  it("a finish enqueued while an op of its workout has already failed is failed at once, blocked by it", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "x" } });
    await flush();
    t.reject("setExerciseNote", apiError(400));
    await flush();
    const note = t.outbox.getState().ops[0]!;
    t.outbox.enqueueFinish(finishInput());
    await flush();
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ status: "failed", failure: { status: 400, blockedBy: note.id } });
    expect(t.rest.finish).not.toHaveBeenCalled();
  });

  it("ops of another workout never hold or fail the finish", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "other", workoutExerciseId: "we-o", body: setBody(KEY2) });
    await flush();
    t.reject("createSet", apiError(422));
    await flush();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    expect(t.calls()).toEqual(["finish"]);
  });

  it.each([
    ["enqueueCreate", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() })],
    ["enqueueUpdate", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { setId: S1 }, body: { reps: 9 } })],
    ["enqueueDelete", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueDelete({ workoutId: "w", workoutExerciseId: "we", target: { setId: S1 } })],
    ["enqueueNote", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "x" } })],
    ["enqueueRound", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueRound({ workoutId: "w", sectionId: "s", round: 1, body: { seconds: 60 } })],
    ["enqueueResult", (o: ReturnType<typeof setup>["outbox"]) => o.enqueueResult({ workoutId: "w", sectionId: "s", body: null })],
  ])("%s on a workout with a non-failed finish is refused, reported once with a static tag", (_name, write) => {
    const t = setup({ isOnline: () => false });
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    write(t.outbox);
    write(t.outbox);
    expect(t.outbox.getState().ops.map((o) => o.kind)).toEqual(["finish"]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    const [error, context] = observability.reportError.mock.calls[0]!;
    expect((error as Error).message).toBe("outbox write refused: the workout is finishing");
    expect(context).toEqual({ source: "workout-outbox" });
  });

  it("a write to a workout whose finish has failed is accepted (the lifter is fixing it)", () => {
    const t = setup({ isOnline: () => false });
    t.outbox.start();
    t.outbox.__setForTests([{ ...finishOpOf("w"), status: "failed", failure: { status: 409, type: "incomplete-working-sets", requestId: null } }]);
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    expect(t.outbox.getState().ops.map((o) => o.kind)).toEqual(["finish", "create"]);
  });
});

function finishOpOf(workoutId: string, over: Partial<FinishOp> = {}): FinishOp {
  return { id: `f-${workoutId}`, workoutId, userId: "u1", status: "queued", attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: Date.now(), kind: "finish", body: { endedAt: ENDED }, meta: META, ...over };
}

describe("06.7 AC3 — sending and reconciling a finish", () => {
  it("a 2xx lands: the op leaves and onFinishSynced gets the response as 'landed'", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    const response = updated();
    t.resolve("finish", response);
    await flush();
    expect(t.outbox.getState().ops).toEqual([]);
    expect(t.onFinishSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "finish" }), { outcome: "landed", updated: response });
    expect(t.onSynced).not.toHaveBeenCalled();
  });

  it.each([
    ["the same instant (to the millisecond)", "2026-11-08T10:15:00.000Z", "ours"],
    ["the same instant written another way", "2026-11-08T04:15:00.000-06:00", "ours"],
    ["another end time", "2026-11-08T10:15:00.001Z", "elsewhere"],
  ])("409 workout-finished then a read with %s → %s", async (_name, endedAt, outcome) => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "workout-finished"));
    await flush();
    expect(t.calls()).toEqual(["getById"]);
    expect(t.rest.getById).toHaveBeenCalledWith("w", { signal: expect.any(AbortSignal) });
    const read = detail(endedAt);
    t.resolve("getById", read);
    await flush();
    expect(t.outbox.getState().ops).toEqual([]);
    expect(t.onFinishSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "finish" }), { outcome, detail: read });
  });

  it("409 then a read with endedAt null fails the finish (with the 409's failure)", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "workout-finished"));
    await flush();
    t.resolve("getById", detail(null));
    await flush();
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ status: "failed", failure: { status: 409, type: "workout-finished" } });
    expect(t.onFinishSynced).not.toHaveBeenCalled();
    expect(t.onFinishFailed).toHaveBeenCalledTimes(1);
  });

  it("409 then a network error on the read retries the finish with the backoff", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "workout-finished"));
    await flush();
    t.reject("getById", network());
    await flush();
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ status: "queued", attempted: true, attempts: 1, nextAttemptAt: Date.now() + 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.calls()).toEqual(["finish"]);
  });

  it("409 then a 404 on the read fails the finish (the workout is gone)", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "workout-finished"));
    await flush();
    t.reject("getById", apiError(404, "not-found"));
    await flush();
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ status: "failed", failure: { status: 404 } });
  });

  it("the reconcile read has the send timeout", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "workout-finished"));
    await flush();
    expect(t.calls()).toEqual(["getById"]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(finishOf(t.outbox.getState().ops)).toMatchObject({ status: "queued", attempts: 1 });
  });

  it.each([
    ["a network failure", network(), "queued"],
    ["500", apiError(500), "queued"],
    ["429", apiError(429), "queued"],
    ["409 incomplete-working-sets", apiError(409, "incomplete-working-sets"), "failed"],
    ["404", apiError(404), "failed"],
    ["400", apiError(400), "failed"],
  ])("%s on the finish → %s", async (_name, error, status) => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", error);
    await flush();
    expect(finishOf(t.outbox.getState().ops)!.status).toBe(status);
  });

  it("a note's 404 while the finish waits fails the note (06.7 AC6 through the drainer), and so the finish", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "x" } });
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("setExerciseNote", apiError(404));
    await flush();
    expect(t.outbox.getState().ops.map((o) => [o.kind, o.status])).toEqual([
      ["note", "failed"],
      ["finish", "failed"],
    ]);
  });
});

describe("06.7 AC4 — a replay sends the same finish", () => {
  it("a 'sending' finish on load becomes queued and attempted, sends the same body, and its 409 reconciles as ours", async () => {
    const storage: StorageAdapter = memoryStorageAdapter();
    const op = finishOpOf("w", { status: "sending", attempted: true, attempts: 1, body: { endedAt: ENDED, keepRoutine: true } });
    storage.set(outboxKey("u1"), JSON.stringify({ v: 1, userId: "u1", ops: [op], idMap: {} }));
    const t = setup({ storage, isOnline: () => false });
    expect(t.outbox.getState().ops[0]).toMatchObject({ status: "queued", attempted: true });

    const online = setup({ storage });
    online.outbox.start();
    await flush();
    expect(online.rest.finish).toHaveBeenCalledWith("w", { endedAt: ENDED, keepRoutine: true }, expect.anything());
    online.reject("finish", apiError(409, "workout-finished"));
    await flush();
    const read = detail(ENDED);
    online.resolve("getById", read);
    await flush();
    expect(online.onFinishSynced).toHaveBeenCalledWith(expect.objectContaining({ id: op.id }), { outcome: "ours", detail: read });
  });

  it("a retried finish sends the endedAt fixed at enqueue, not the time of sending", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", network());
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.rest.finish.mock.calls.map((c) => c[1])).toEqual([{ endedAt: ENDED }, { endedAt: ENDED }]);
  });
});

describe("06.7 AC12 — finish ops never count as set failures", () => {
  it("a refused finish fires workout_finish_failed { status } once, never set_sync_failed, and never onFailed (so no /active re-read)", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("finish", apiError(409, "incomplete-working-sets"));
    await flush();
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_finish_failed")).toEqual([["workout_finish_failed", { status: 409 }]]);
    expect(observability.track.mock.calls.some(([e]) => e === "set_sync_failed")).toBe(false);
    expect(t.onFailed).not.toHaveBeenCalled();
    expect(t.onFinishFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: "finish" }), expect.any(ApiError));
  });

  it("a slow landing never fires set_sync_delayed", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueFinish(finishInput());
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    t.resolve("finish", updated());
    await flush();
    expect(observability.track.mock.calls.some(([e]) => e === "set_sync_delayed")).toBe(false);
  });

  it("a set failure that blocks the finish counts once as a set failure, never twice", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    t.outbox.enqueueFinish(finishInput());
    await flush();
    t.reject("createSet", apiError(400));
    await flush();
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toHaveLength(1);
    expect(t.onFailed).toHaveBeenCalledTimes(1);
    expect(t.onFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: "create" }), expect.anything());
  });
});

describe("06.7 AC2, AC3 — whenFinishSettles", () => {
  it("resolves landed on success, after onFinishSynced ran", async () => {
    const t = setup();
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    const order: string[] = [];
    t.onFinishSynced.mockImplementation(() => order.push("synced"));
    const settled = t.outbox.whenFinishSettles(id, 8000).then((v) => {
      order.push(v);
      return v;
    });
    await flush();
    t.resolve("finish", updated());
    await expect(settled).resolves.toBe("landed");
    expect(order).toEqual(["synced", "landed"]);
  });

  it("resolves pending at the timeout, and the request is not canceled", async () => {
    const t = setup();
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    const settled = t.outbox.whenFinishSettles(id, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(settled).resolves.toBe("pending");
    expect(finishOf(t.outbox.getState().ops)!.status).toBe("sending");
    t.resolve("finish", updated());
    await flush();
    expect(t.onFinishSynced).toHaveBeenCalledTimes(1);
  });

  it("resolves pending on a failure", async () => {
    const t = setup();
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    const settled = t.outbox.whenFinishSettles(id, 8000);
    await flush();
    t.reject("finish", apiError(400));
    await expect(settled).resolves.toBe("pending");
  });

  it("an op that already landed resolves landed; an unknown op resolves pending", async () => {
    const t = setup();
    t.outbox.start();
    const id = t.outbox.enqueueFinish(finishInput());
    await flush();
    t.resolve("finish", updated());
    await flush();
    await expect(t.outbox.whenFinishSettles(id, 8000)).resolves.toBe("landed");
    await expect(t.outbox.whenFinishSettles("nope", 8000)).resolves.toBe("pending");
  });

  it("a finish waiting behind sets resolves landed when it lands within the budget", async () => {
    const t = setup();
    t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    const id = t.outbox.enqueueFinish(finishInput());
    const settled = t.outbox.whenFinishSettles(id, 8000);
    await vi.advanceTimersByTimeAsync(1000);
    t.resolve("createSet", makeSet({ id: S1, clientGeneratedId: KEY }) as SetEntry);
    await vi.advanceTimersByTimeAsync(1000);
    t.resolve("finish", updated());
    await expect(settled).resolves.toBe("landed");
  });
});
