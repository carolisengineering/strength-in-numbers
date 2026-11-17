import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { QueryClient } from "@tanstack/react-query";
import { UpdatedWorkoutSchema, type PersonalRecord, type UpdatedWorkout, type WorkoutDetail } from "@sin/core";
import { memoryStorageAdapter } from "../../storage/storage";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { fakeClient } from "../../test/workoutHarness";
import { RECORDS_KEYS } from "../records/queries";
import { __resetFinishListeners, emitWorkoutFinished, onWorkoutFinished } from "./finishEvents";
import { createFinishLanding } from "./finishLanding";
import type { FinishMeta, FinishOp } from "./outbox/ops";
import { createOutbox } from "./outbox/outbox";
import { createQueuedWorkoutClient } from "./outbox/queuedWorkoutClient";
import { WORKOUT_KEYS } from "./queries";

const STARTED = "2026-11-08T09:00:00.000Z";
const ENDED = "2026-11-08T10:15:00.000Z";
const NOW = Date.parse("2026-11-08T10:20:00.000Z");
const META: FinishMeta = { startedAt: STARTED, exerciseCount: 1, setCount: 2, endedEarly: true, unloggedPlannedSets: 3, hadPlannedDuration: true };

const workoutOf = () =>
  makeWorkoutDetail({
    startedAt: STARTED,
    exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 })] }],
  });
const opOf = (workout: WorkoutDetail, over: Partial<FinishOp> = {}): FinishOp => ({
  id: "finish-1",
  workoutId: workout.id,
  userId: "u1",
  status: "sending",
  attempted: true,
  attempts: 1,
  nextAttemptAt: 0,
  enqueuedAt: NOW - 60_000,
  kind: "finish",
  body: { endedAt: ENDED },
  meta: META,
  ...over,
});
// The PATCH response is the workout row (no exercises or sections) plus newRecords: the schema strips the rest.
const updatedOf = (workout: WorkoutDetail, newRecords: PersonalRecord[] = []): UpdatedWorkout =>
  UpdatedWorkoutSchema.parse({ ...workout, endedAt: ENDED, plannedDurationSeconds: null, newRecords });

function setup(active?: WorkoutDetail | null) {
  const workout = workoutOf();
  const queryClient = new QueryClient();
  queryClient.setQueryData(WORKOUT_KEYS.active, active === undefined ? workout : active);
  const drafts = { clearWorkout: vi.fn() };
  const rest = { clearWorkout: vi.fn() };
  const waiting = new Set<string>();
  const land = createFinishLanding({ queryClient, drafts, rest, waiting, now: () => NOW });
  return { workout, queryClient, drafts, rest, waiting, land };
}

const events = () => observability.track.mock.calls.map((c) => c[0] as string);
const propsOf = (name: string) => observability.track.mock.calls.find((c) => c[0] === name)?.[1] as Record<string, unknown> | undefined;

afterEach(() => {
  __resetFinishListeners();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC14 — an active read in flight at landing can't bring the workout back (minor 627)", () => {
  it("the landing cancels it, so the live copy it read never overwrites the null", async () => {
    const t = setup();
    let release!: (w: WorkoutDetail) => void;
    // A refetch (reconnect or focus) that read the server before the finish committed.
    void t.queryClient.fetchQuery({
      queryKey: WORKOUT_KEYS.active,
      queryFn: () => new Promise<WorkoutDetail>((resolve) => (release = resolve)),
      staleTime: 0,
    });
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.active)).toBeNull();
    release(t.workout);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.active)).toBeNull();
  });
});

describe("06.7 AC14 — landing effects run in one place, once", () => {
  it("landed: §6.6's effects run in order, and the Hevy event goes last, with every cache already seeded", () => {
    const t = setup();
    const record = makePersonalRecord({ workoutId: t.workout.id });
    const seen: unknown[] = [];
    onWorkoutFinished(({ workoutId }) => {
      seen.push({
        detail: t.queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId))?.endedAt,
        records: t.queryClient.getQueryData(RECORDS_KEYS.forWorkout(workoutId)),
        active: t.queryClient.getQueryData(WORKOUT_KEYS.active),
        drafts: t.drafts.clearWorkout.mock.calls.length,
        rest: t.rest.clearWorkout.mock.calls.length,
        tracked: events(),
      });
    });
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout, [record]) });
    expect(seen).toEqual([
      { detail: ENDED, records: [record], active: null, drafts: 1, rest: 1, tracked: ["workout_finished"] },
    ]);
    // The detail keeps the exercises the response lacks (from the active cache), with the server's times.
    const detail = t.queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(t.workout.id))!;
    expect(detail.exercises).toHaveLength(1);
    expect(detail.plannedDurationSeconds).toBeNull();
    expect(t.drafts.clearWorkout).toHaveBeenCalledWith(t.workout.id);
    expect(t.rest.clearWorkout).toHaveBeenCalledWith(t.workout.id);
  });

  it("workout_finished is built from the op's meta: queued false while a tap waits on it, and no waitedMs", () => {
    const t = setup();
    t.waiting.add("finish-1");
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    expect(propsOf("workout_finished")).toEqual({
      exerciseCount: 1,
      setCount: 2,
      durationMin: 75,
      endedEarly: true,
      unloggedPlannedSets: 3,
      hadPlannedDuration: true,
      queued: false,
    });
  });

  it("a landing nobody waits on was queued: queued true and waitedMs from the enqueue", () => {
    const t = setup();
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    expect(propsOf("workout_finished")).toMatchObject({ queued: true, waitedMs: 60_000 });
  });

  it("Review Focus 4 — ours: the detail is the re-read, records are fetched by id (a cached [] can't pretend there were none), viaReplay", () => {
    const t = setup();
    t.queryClient.setQueryData(RECORDS_KEYS.forWorkout(t.workout.id), []);
    const listener = vi.fn();
    onWorkoutFinished(listener);
    const reread = { ...t.workout, endedAt: ENDED, title: "Server copy" };
    t.land(opOf(t.workout), { outcome: "ours", detail: reread });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.detail(t.workout.id))).toEqual(reread);
    expect(t.queryClient.getQueryState(RECORDS_KEYS.forWorkout(t.workout.id))).toBeUndefined();
    expect(propsOf("workout_finished")).toMatchObject({ viaReplay: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("Review Focus 4 — elsewhere: the re-read and no cached records; workout_finish_elsewhere instead of workout_finished, and no Hevy event", () => {
    const t = setup();
    t.queryClient.setQueryData(RECORDS_KEYS.forWorkout(t.workout.id), []);
    const listener = vi.fn();
    onWorkoutFinished(listener);
    const reread = { ...t.workout, endedAt: "2026-11-08T10:05:00.000Z" };
    t.land(opOf(t.workout), { outcome: "elsewhere", detail: reread });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.detail(t.workout.id))).toEqual(reread);
    expect(t.queryClient.getQueryState(RECORDS_KEYS.forWorkout(t.workout.id))).toBeUndefined();
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.active)).toBeNull();
    expect(events()).toEqual(["workout_finish_elsewhere"]);
    expect(listener).not.toHaveBeenCalled();
    expect(t.drafts.clearWorkout).toHaveBeenCalledWith(t.workout.id);
  });

  it("['workouts','active'] becomes null only if it holds this workout", () => {
    const other = workoutOf();
    const t = setup(other);
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.active)).toBe(other);
  });

  it("landed with no cached copy: records are seeded, the detail is left for the summary to read", () => {
    const t = setup(null);
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.detail(t.workout.id))).toBeUndefined();
    expect(t.queryClient.getQueryData(RECORDS_KEYS.forWorkout(t.workout.id))).toEqual([]);
  });

  it("landed onto a detail seeded at the tap (no active copy): written from the response, then re-read for the server's set ids", () => {
    const t = setup(null);
    const seeded = { ...t.workout, endedAt: ENDED };
    t.queryClient.setQueryData(WORKOUT_KEYS.detail(t.workout.id), seeded);
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    const state = t.queryClient.getQueryState(WORKOUT_KEYS.detail(t.workout.id))!;
    expect(state.data).toMatchObject({ id: t.workout.id, endedAt: ENDED, exercises: seeded.exercises });
    expect(state.isInvalidated).toBe(true);
  });

  it("a double completion (a 409 replay after a lost reply) emits once; a 20.2 listener sees one event", () => {
    const t = setup();
    const listener = vi.fn();
    onWorkoutFinished(listener);
    t.land(opOf(t.workout), { outcome: "landed", updated: updatedOf(t.workout) });
    t.land(opOf(t.workout), { outcome: "ours", detail: { ...t.workout, endedAt: ENDED } });
    expect(listener.mock.calls).toEqual([[{ workoutId: t.workout.id }]]);
  });
});

describe("06.7 AC27 — a landing off-screen is remembered for the one-time line (provider step 6)", () => {
  const bench = { modality: "weight_reps" as const, name: "Bench", sets: [makeSet({ setNumber: 1, reps: 5, weight: 100, weightKg: 100 })] };
  const squat = { modality: "weight_reps" as const, name: "Squat", sets: [makeSet({ setNumber: 1, reps: 5, weight: 140, weightKg: 140 })] };
  const twoLifts = () => makeWorkoutDetail({ startedAt: STARTED, exercises: [bench, squat] });
  const recordOn = (workout: WorkoutDetail, i: number, o: Record<string, unknown>) => {
    const e = workout.exercises[i]!;
    return makePersonalRecord({
      exerciseId: e.exerciseId,
      sourceExerciseId: e.exerciseId,
      exerciseName: e.exerciseNameSnapshot,
      sourceSetId: e.sets[0]!.id,
      workoutId: workout.id,
      unit: "kg",
      ...o,
    });
  };
  const heaviest = (value: number, previousValue: number) => ({ recordType: "heaviest_weight", value, previousValue });
  const estimate = (value: number, previousValue: number) => ({ recordType: "best_est_1rm", value, previousValue });

  function landing(workout: WorkoutDetail, isViewing = false) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(WORKOUT_KEYS.active, workout);
    const landed = { add: vi.fn() };
    const land = createFinishLanding({ queryClient, waiting: new Set(), landed, viewing: () => isViewing });
    return { land, landed };
  }

  it.each([
    ["two records on one lift and one on another: 2 lifts, not 3 records", (w: WorkoutDetail) => [recordOn(w, 0, heaviest(105, 100)), recordOn(w, 0, estimate(120, 115)), recordOn(w, 1, heaviest(145, 140))], 2],
    ["a set-volume record only: 0", (w: WorkoutDetail) => [recordOn(w, 0, { recordType: "best_set_volume", value: 600, previousValue: 500, unit: "kg_reps" })], 0],
    ["one lift that rose beside a value-only lift: 1 (minor 476)", (w: WorkoutDetail) => [recordOn(w, 0, heaviest(105, 100)), recordOn(w, 1, estimate(94.1, 94))], 1],
    ["only a value-only lift: 0 (minor 476)", (w: WorkoutDetail) => [recordOn(w, 1, estimate(94.1, 94))], 0],
  ])("lifts is the summary heading's count — %s", (_name, records, lifts) => {
    const workout = twoLifts();
    const t = landing(workout);
    t.land(opOf(workout), { outcome: "landed", updated: updatedOf(workout, records(workout)) });
    expect(t.landed.add).toHaveBeenCalledWith({ workoutId: workout.id, lifts, how: "landed" });
  });

  it.each(["ours", "elsewhere"] as const)("%s stores lifts: null", (how) => {
    const workout = twoLifts();
    const t = landing(workout);
    t.land(opOf(workout), { outcome: how, detail: { ...workout, endedAt: ENDED } });
    expect(t.landed.add).toHaveBeenCalledWith({ workoutId: workout.id, lifts: null, how });
  });

  it("landed with no copy of the workout to count from stores lifts: null", () => {
    const workout = twoLifts();
    const queryClient = new QueryClient();
    const landed = { add: vi.fn() };
    createFinishLanding({ queryClient, waiting: new Set(), landed, viewing: () => false })(opOf(workout), {
      outcome: "landed",
      updated: updatedOf(workout, [recordOn(workout, 0, heaviest(105, 100))]),
    });
    expect(landed.add).toHaveBeenCalledWith({ workoutId: workout.id, lifts: null, how: "landed" });
  });

  it("writes no entry while that workout's summary is open", () => {
    const workout = twoLifts();
    const t = landing(workout, true);
    t.land(opOf(workout), { outcome: "landed", updated: updatedOf(workout, []) });
    expect(t.landed.add).not.toHaveBeenCalled();
  });

  it("the entry is written before the Hevy event (step 6, then 7)", () => {
    const workout = twoLifts();
    const t = landing(workout);
    const order: string[] = [];
    t.landed.add.mockImplementation(() => order.push("landed"));
    onWorkoutFinished(() => order.push("emit"));
    t.land(opOf(workout), { outcome: "landed", updated: updatedOf(workout, []) });
    expect(order).toEqual(["landed", "emit"]);
  });
});

describe("06.7 AC14 — finishEvents emits at most once per workout per page load", () => {
  it("a second emit for the same workout is dropped; another workout still emits", () => {
    const listener = vi.fn();
    onWorkoutFinished(listener);
    emitWorkoutFinished({ workoutId: "w1" });
    emitWorkoutFinished({ workoutId: "w1" });
    emitWorkoutFinished({ workoutId: "w2" });
    expect(listener.mock.calls).toEqual([[{ workoutId: "w1" }], [{ workoutId: "w2" }]]);
  });

  it("the test reset forgets what was emitted", () => {
    const listener = vi.fn();
    emitWorkoutFinished({ workoutId: "w1" });
    __resetFinishListeners();
    onWorkoutFinished(listener);
    emitWorkoutFinished({ workoutId: "w1" });
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("06.7 AC14 — Review Focus 1: the effects have run before a waiting tap resolves landed", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it("finishOrQueue resolves landed with the summary's caches already seeded", async () => {
    const workout = workoutOf();
    const queryClient = new QueryClient();
    queryClient.setQueryData(WORKOUT_KEYS.active, workout);
    const waiting = new Set<string>();
    const land = createFinishLanding({ queryClient, waiting });
    const finish = vi.fn(async () => updatedOf(workout, []));
    const rest = fakeClient({ finish });
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => true, onFinishSynced: land });
    const stop = outbox.start();
    const client = createQueuedWorkoutClient({ rest, outbox, cached: () => queryClient.getQueryData(WORKOUT_KEYS.active), finishWaits: waiting });
    const seen = await client.finishOrQueue(workout.id, { endedAt: ENDED }, META).then((r) => ({
      r,
      detail: queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id))?.endedAt,
      records: queryClient.getQueryData(RECORDS_KEYS.forWorkout(workout.id)),
      active: queryClient.getQueryData(WORKOUT_KEYS.active),
    }));
    stop();
    // Minor 632: while the tap waits, the landing leaves the active entry; the tap's summary clears it (06.4 D1).
    expect(seen).toEqual({ r: { status: "landed" }, detail: ENDED, records: [], active: workout });
    expect(propsOf("workout_finished")).toMatchObject({ queued: false });
    expect(propsOf("workout_finished")).not.toHaveProperty("waitedMs");
    expect(waiting.size).toBe(0);
  });
});
