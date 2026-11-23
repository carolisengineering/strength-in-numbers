import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError, SESSION_EXPIRED_TITLE } from "../../../api";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { classify, failureOf } from "./classify";
import type { FinishMeta } from "./ops";
import { createOutbox, outboxKey, type OutboxDeps } from "./outbox";
import { createQueuedWorkoutClient, WorkoutFinishingError } from "./queuedWorkoutClient";

const ENDED = "2026-11-08T10:15:00.000Z";
const META: FinishMeta = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const KEY = "30000000-0000-4000-8000-000000000001";
const apiError = (status: number, slug = "") =>
  new ApiError({ status, type: slug ? `https://api.strengthinnumbers.app/problems/${slug}` : "about:blank", title: "t", requestId: `req-${status}` });

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC2 — a write refused because a finish waits is said, never shown as saved (minor 613)", () => {
  function setup() {
    const workout = makeWorkoutDetail({
      exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }],
      sections: [{ name: "Finisher" }],
    });
    const rest = fakeClient();
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
    const client = createQueuedWorkoutClient({ rest, outbox, cached: () => workout });
    return { workout, outbox, client };
  }

  it("each enqueue says whether it queued: true before the finish, false once one waits", () => {
    const t = setup();
    const target = { workoutId: t.workout.id, workoutExerciseId: t.workout.exercises[0]!.id };
    expect(t.outbox.enqueueNote({ ...target, body: { notes: "x" } })).toBe(true);
    t.outbox.enqueueFinish({ workoutId: t.workout.id, body: { endedAt: ENDED }, meta: META });
    expect(t.outbox.enqueueCreate({ ...target, body: { clientGeneratedId: KEY, reps: 5, isComplete: true } })).toBe(false);
    expect(t.outbox.enqueueUpdate({ ...target, target: { setId: t.workout.exercises[0]!.sets[0]!.id }, body: { reps: 6 } })).toBe(false);
    expect(t.outbox.enqueueDelete({ ...target, target: { setId: t.workout.exercises[0]!.sets[0]!.id } })).toBe(false);
    expect(t.outbox.enqueueNote({ ...target, body: { notes: "y" } })).toBe(false);
    const section = { workoutId: t.workout.id, sectionId: t.workout.sections[0]!.id };
    expect(t.outbox.enqueueRound({ ...section, round: 1, body: { seconds: 60 } })).toBe(false);
    expect(t.outbox.enqueueResult({ ...section, body: null })).toBe(false);
  });

  it("the queued client rejects every refused write with WorkoutFinishingError", async () => {
    const t = setup();
    const we = t.workout.exercises[0]!;
    const setId = we.sets[0]!.id;
    const sectionId = t.workout.sections[0]!.id;
    t.outbox.enqueueFinish({ workoutId: t.workout.id, body: { endedAt: ENDED }, meta: META });
    await expect(t.client.createSet(we.id, { clientGeneratedId: KEY, reps: 5, isComplete: true })).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.updateSet(setId, { reps: 6 })).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.deleteSet(setId)).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.setExerciseNote(we.id, "x")).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.putRoundTime(sectionId, 1, 60)).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.deleteRoundTime(sectionId, 1)).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.putResult(sectionId, { score: { kind: "time", seconds: 300 } } as never)).rejects.toBeInstanceOf(WorkoutFinishingError);
    await expect(t.client.deleteResult(sectionId)).rejects.toBeInstanceOf(WorkoutFinishingError);
    expect(t.outbox.getState().ops.map((o) => o.kind)).toEqual(["finish"]);
  });

  it("a failed finish no longer refuses: the lifter fixes the workout before tapping Finish again (AC29)", async () => {
    const t = setup();
    t.outbox.enqueueFinish({ workoutId: t.workout.id, body: { endedAt: ENDED }, meta: META });
    t.outbox.__setForTests(t.outbox.getState().ops.map((o) => ({ ...o, status: "failed" as const })));
    await expect(t.client.setExerciseNote(t.workout.exercises[0]!.id, "fixed")).resolves.toMatchObject({ notes: "fixed" });
  });
});

describe("06.7 AC1 — a finish op that doesn't fit the schema is a programming error, never written (minor 614)", () => {
  it.each([
    ["a NaN count", { ...META, setCount: Number.NaN }],
    ["a fractional count", { ...META, exerciseCount: 1.5 }],
    ["a negative count", { ...META, unloggedPlannedSets: -1 }],
  ])("%s throws, and the file keeps the unsent sets", (_name, meta) => {
    const storage = memoryStorageAdapter();
    const outbox = createOutbox({ storage, rest: fakeClient(), userId: "u1", isOnline: () => false });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    expect(() => outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta })).toThrow();
    expect(outbox.getState().ops.map((o) => o.kind)).toEqual(["create"]);
    const reloaded = createOutbox({ storage, rest: fakeClient(), userId: "u1", isOnline: () => false });
    expect(reloaded.getState().ops.map((o) => o.kind)).toEqual(["create"]);
    expect(storage.get(outboxKey("u1"))).not.toBeNull();
  });
});

describe("06.7 AC12 — a finish removed mid-send fires no failure (minor 616)", () => {
  function setup(over: Partial<OutboxDeps> = {}) {
    const calls: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
    const finish = vi.fn(() => new Promise<never>((resolve, reject) => calls.push({ resolve: resolve as (v: unknown) => void, reject })));
    const onFinishFailed = vi.fn();
    const onFinishSynced = vi.fn();
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: fakeClient({ finish }), userId: "u1", isOnline: () => true, onFinishFailed, onFinishSynced, ...over });
    const stop = outbox.start();
    return { outbox, calls, onFinishFailed, onFinishSynced, stop };
  }

  it.each([
    ["dropWorkout", (t: ReturnType<typeof setup>) => t.outbox.dropWorkout("w")],
    ["discard", (t: ReturnType<typeof setup>) => t.outbox.discard(t.outbox.getState().ops[0]!.id)],
  ])("after %s, the reply's refusal tracks nothing and calls no one", async (_name, remove) => {
    const t = setup();
    t.outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    await vi.advanceTimersByTimeAsync(0);
    remove(t);
    t.calls[0]!.reject(apiError(422));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.onFinishFailed).not.toHaveBeenCalled();
    expect(observability.track).not.toHaveBeenCalledWith("workout_finish_failed", expect.anything());
    expect(t.outbox.getState().ops).toEqual([]);
    t.stop();
  });

  it("control: still in the queue, the refusal is said once", async () => {
    const t = setup();
    t.outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    await vi.advanceTimersByTimeAsync(0);
    t.calls[0]!.reject(apiError(422));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.onFinishFailed).toHaveBeenCalledOnce();
    t.stop();
  });
});

describe("06.7 AC3 — a lost session retries a finish instead of failing it (minor 617)", () => {
  const sessionExpired = () =>
    new ApiError({ status: 0, type: "about:blank", title: SESSION_EXPIRED_TITLE, requestId: "r", isNetworkError: false });

  it("a 401 and the session-expired error are retry for a finish", () => {
    expect(classify("finish", apiError(401))).toBe("retry");
    expect(classify("finish", sessionExpired())).toBe("retry");
  });

  it("other op kinds are unchanged", () => {
    expect(classify("create", apiError(401))).toBe("fail");
    expect(classify("note", sessionExpired())).toBe("fail");
  });
});

describe("minor 633 — a lost sign-in never locks a waiting finish", () => {
  const sessionExpired = () =>
    new ApiError({ status: 0, type: "about:blank", title: SESSION_EXPIRED_TITLE, requestId: "r", isNetworkError: false });

  /** The memory adapter, with `blockUserDataWrites`' effect: once blocked, a write is a silent no-op. */
  function blockable() {
    const inner = memoryStorageAdapter();
    let blocked = false;
    const storage = { ...inner, set: (k: string, v: string) => (blocked ? undefined : inner.set(k, v)), remove: (k: string) => (blocked ? undefined : inner.remove(k)) };
    return { storage, block: () => (blocked = true) };
  }

  function setup(error: () => unknown) {
    const store = blockable();
    // The API client calls onAuthLost (a forced sign-out blocks storage writes) before the error reaches the outbox.
    const createSet = vi.fn(() =>
      Promise.resolve().then(() => {
        store.block();
        throw error();
      }),
    );
    const onFinishFailed = vi.fn();
    const outbox = createOutbox({ storage: store.storage, rest: fakeClient({ createSet }), userId: "u1", isOnline: () => true, onFinishFailed });
    const stop = outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    return { store, outbox, onFinishFailed, stop };
  }

  it.each([
    ["401", () => apiError(401)],
    ["session expired", sessionExpired],
  ])("a set save that fails with %s leaves the finish queued, not failed, and tracks no workout_finish_failed", async (_name, error) => {
    const t = setup(error);
    await vi.advanceTimersByTimeAsync(0);
    const [set, finish] = t.outbox.getState().ops;
    expect(set).toMatchObject({ kind: "create", status: "failed" });
    expect(finish).toMatchObject({ kind: "finish", status: "queued" });
    expect(finish!.failure).toBeUndefined();
    expect(t.onFinishFailed).not.toHaveBeenCalled();
    expect(observability.track).not.toHaveBeenCalledWith("workout_finish_failed", expect.anything());
    t.stop();
  });

  it("other failures still block the finish (Spec 06.7 AC2, unchanged)", async () => {
    const t = setup(() => apiError(422));
    await vi.advanceTimersByTimeAsync(0);
    const [set, finish] = t.outbox.getState().ops;
    expect(finish).toMatchObject({ kind: "finish", status: "failed", failure: { status: 422, blockedBy: set!.id } });
    expect(t.onFinishFailed).toHaveBeenCalledOnce();
    t.stop();
  });

  it("a stored op that failed on a lost sign-in (a file from before a reload) doesn't block a finish either", () => {
    const storage = memoryStorageAdapter();
    const seed = createOutbox({ storage, rest: fakeClient(), userId: "u1", isOnline: () => false });
    seed.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    seed.__setForTests(seed.getState().ops.map((o) => ({ ...o, status: "failed" as const, failure: { status: 401, type: "about:blank", requestId: "r" } })));
    seed.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    expect(seed.getState().ops.find((o) => o.kind === "finish")).toMatchObject({ status: "queued" });
  });

  it("Review Focus 3: after a new sign-in, the set's retry lands and the waiting finish goes", async () => {
    const t = setup(() => apiError(401));
    await vi.advanceTimersByTimeAsync(0);
    t.stop();
    // The page signs out and comes back: a new outbox reads the file the blocked writes left (the set still `sending`).
    const createSet = vi.fn(() => Promise.resolve(makeSet({ clientGeneratedId: KEY })));
    const detail = makeWorkoutDetail({ endedAt: ENDED });
    const finish = vi.fn(() => Promise.resolve({ ...detail, newRecords: [] }));
    const onFinishSynced = vi.fn();
    const next = createOutbox({ storage: memoryStorageAdapter({ [outboxKey("u1")]: t.store.storage.get(outboxKey("u1"))! }), rest: fakeClient({ createSet, finish }), userId: "u1", isOnline: () => true, onFinishSynced });
    const stop = next.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(createSet).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(onFinishSynced).toHaveBeenCalledOnce();
    expect(next.getState().ops).toEqual([]);
    stop();
  });

  /** A file left with a create that failed on a lost sign-in (status 401) and a queued finish behind it. */
  function strandedFile() {
    const storage = memoryStorageAdapter();
    const seed = createOutbox({ storage, rest: fakeClient(), userId: "u1", isOnline: () => false });
    seed.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    seed.__setForTests(seed.getState().ops.map((o) => ({ ...o, status: "failed" as const, attempted: true, failure: { status: 401, type: "about:blank", requestId: "r" } })));
    seed.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    return storage;
  }

  function sender(storage: ReturnType<typeof memoryStorageAdapter>, isOnline = () => true) {
    const detail = makeWorkoutDetail({ endedAt: ENDED });
    const createSet = vi.fn(() => Promise.resolve(makeSet({ clientGeneratedId: KEY })));
    const finish = vi.fn(() => Promise.resolve({ ...detail, newRecords: [] }));
    const onFinishSynced = vi.fn();
    const outbox = createOutbox({ storage, rest: fakeClient({ createSet, finish }), userId: "u1", isOnline, onFinishSynced });
    return { outbox, createSet, finish, onFinishSynced };
  }

  it("code review: a stored op that failed on a lost sign-in goes back to the queue on load, so the waiting finish isn't stranded", async () => {
    const t = sender(strandedFile());
    expect(t.outbox.getState().ops.map((o) => o.status)).toEqual(["queued", "queued"]);
    expect(t.outbox.getState().ops[0]!.failure).toBeUndefined();
    const stop = t.outbox.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.createSet).toHaveBeenCalledOnce();
    expect(t.onFinishSynced).toHaveBeenCalledOnce();
    expect(t.outbox.getState().ops).toEqual([]);
    stop();
  });

  it("code review: Retry now sends an op that failed on a lost sign-in again; other failures stay failed", async () => {
    const t = sender(memoryStorageAdapter(), () => false);
    const stop = t.outbox.start();
    t.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    t.outbox.enqueueCreate({ workoutId: "w2", workoutExerciseId: "we2", body: { clientGeneratedId: "30000000-0000-4000-8000-000000000002", reps: 5, isComplete: true } });
    const [lost, refused] = t.outbox.getState().ops;
    t.outbox.__setForTests([
      { ...lost!, status: "failed", failure: { status: 0, type: "session-expired", requestId: "r" } },
      { ...refused!, status: "failed", failure: { status: 422, type: "about:blank", requestId: "r" } },
    ]);
    t.outbox.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.createSet).toHaveBeenCalledOnce();
    expect(t.outbox.getState().ops).toEqual([expect.objectContaining({ id: refused!.id, status: "failed" })]);
    stop();
  });

  it("failureOf names a session-expired failure", () => {
    expect(failureOf(sessionExpired()).type).toBe("session-expired");
    expect(failureOf(apiError(401)).type).toBe("about:blank");
  });
});
