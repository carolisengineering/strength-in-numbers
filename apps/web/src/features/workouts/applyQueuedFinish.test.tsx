import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { QueryClient } from "@tanstack/react-query";
import type { WorkoutDetail } from "@sin/core";
import { memoryStorageAdapter } from "../../storage/storage";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { fakeClient } from "../../test/workoutHarness";
import { HISTORY_KEYS } from "../history/queries";
import { RECORDS_KEYS } from "../records/queries";
import { __resetFinishListeners, onWorkoutFinished } from "./finishEvents";
import { createOutbox } from "./outbox/outbox";
import type { FinishMeta, FinishOp } from "./outbox/ops";
import { project } from "./outbox/project";
import { createQueuedWorkoutClient } from "./outbox/queuedWorkoutClient";
import { WORKOUT_KEYS } from "./queries";
import { applyQueuedFinish } from "./useWorkoutMutations";

const ENDED = "2026-11-08T10:15:00.000Z";
const META: FinishMeta = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const workoutOf = () =>
  makeWorkoutDetail({ startedAt: META.startedAt, plannedDurationSeconds: 900, exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }] });
const finishOf = (workout: WorkoutDetail, status: FinishOp["status"]): FinishOp => ({
  id: "finish-1",
  workoutId: workout.id,
  userId: "u1",
  status,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "finish",
  body: { endedAt: ENDED },
  meta: META,
  ...(status === "failed" ? { failure: { status: 422, type: "about:blank", requestId: "r" } } : {}),
});

afterEach(() => {
  __resetFinishListeners();
  observability.track.mockReset();
});

describe("06.7 AC15 — nothing treats a waiting workout as in the cloud (applyQueuedFinish, data half)", () => {
  function setup() {
    const workout = workoutOf();
    const queryClient = new QueryClient();
    queryClient.setQueryData(WORKOUT_KEYS.active, workout);
    const records = [makePersonalRecord({ workoutId: workout.id })];
    queryClient.setQueryData(RECORDS_KEYS.forWorkout(workout.id), records);
    queryClient.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
    const rest = { clearWorkout: vi.fn() };
    const drafts = { clearWorkout: vi.fn() };
    return { workout, queryClient, records, rest, drafts, ops: [finishOf(workout, "queued")] };
  }

  it("seeds the detail with the projected finished copy, clears the rest timer, tracks workout_finish_queued { reason }", () => {
    const t = setup();
    applyQueuedFinish(t.queryClient, { id: t.workout.id, reason: "offline", ops: t.ops, rest: t.rest });
    expect(t.queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(t.workout.id))).toMatchObject({
      id: t.workout.id,
      endedAt: ENDED,
      plannedDurationSeconds: null,
      exercises: [expect.objectContaining({ id: t.workout.exercises[0]!.id })],
    });
    expect(t.rest.clearWorkout).toHaveBeenCalledWith(t.workout.id);
    expect(observability.track.mock.calls).toEqual([["workout_finish_queued", { reason: "offline" }]]);
  });

  it("does nothing else: no Hevy event, no workout_finished, drafts kept, records and History untouched, active still live", () => {
    const t = setup();
    const listener = vi.fn();
    onWorkoutFinished(listener);
    const invalidate = vi.spyOn(t.queryClient, "invalidateQueries");
    const reset = vi.spyOn(t.queryClient, "resetQueries");
    applyQueuedFinish(t.queryClient, { id: t.workout.id, reason: "slow", ops: t.ops, rest: t.rest });
    expect(listener).not.toHaveBeenCalled();
    expect(observability.track.mock.calls.map((c) => c[0])).toEqual(["workout_finish_queued"]);
    expect(t.drafts.clearWorkout).not.toHaveBeenCalled();
    expect(t.queryClient.getQueryData(RECORDS_KEYS.forWorkout(t.workout.id))).toBe(t.records);
    expect(t.queryClient.getQueryState(HISTORY_KEYS.list)?.isInvalidated).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(t.queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)?.endedAt).toBeNull();
  });

  it("with no copy of the workout cached, it seeds nothing (the summary reads one) and still clears and tracks", () => {
    const t = setup();
    t.queryClient.setQueryData(WORKOUT_KEYS.active, null);
    applyQueuedFinish(t.queryClient, { id: t.workout.id, reason: "offline", ops: t.ops, rest: t.rest });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.detail(t.workout.id))).toBeUndefined();
    expect(t.rest.clearWorkout).toHaveBeenCalled();
    expect(observability.track).toHaveBeenCalledWith("workout_finish_queued", { reason: "offline" });
  });
});

describe("06.7 AC19 — a refused finish leaves the workout live (data half)", () => {
  it("project() and the active read ignore a failed finish op: the in-progress workout, endedAt null", async () => {
    const workout = workoutOf();
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: fakeClient(), userId: "u1", isOnline: () => false });
    outbox.__setForTests([finishOf(workout, "failed")]);
    expect(project(workout, outbox.getState()).workout).toBe(workout);
    const client = createQueuedWorkoutClient({ rest: fakeClient({ getActive: async () => workout }), outbox, cached: () => workout });
    const active = await client.getActive();
    expect(active?.endedAt).toBeNull();
    // `settle` keeps the failed op: it is the banner's memory (AC7).
    expect(outbox.getState().ops).toEqual([expect.objectContaining({ kind: "finish", status: "failed" })]);
  });

  it("applyQueuedFinish never applies a failed op: no finished copy is seeded", () => {
    const workout = workoutOf();
    const queryClient = new QueryClient();
    queryClient.setQueryData(WORKOUT_KEYS.active, workout);
    applyQueuedFinish(queryClient, { id: workout.id, reason: "slow", ops: [finishOf(workout, "failed")], rest: { clearWorkout: vi.fn() } });
    expect(queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id))?.endedAt ?? null).toBeNull();
  });
});
