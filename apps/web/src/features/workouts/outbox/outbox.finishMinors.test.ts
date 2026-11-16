import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError, SESSION_EXPIRED_TITLE } from "../../../api";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { classify } from "./classify";
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
