import { describe, expect, it } from "vitest";
import { WorkoutDetailSchema, type WorkoutDetail } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { finishStatsFor } from "../finishStats";
import { FINISH_WAIT_MS, withQueuedFinish } from "./finish";
import type { FinishOp, OutboxOp } from "./ops";

const STARTED = "2026-11-08T09:00:00.000Z";
const ENDED = "2026-11-08T10:15:00.000Z";

const live = (over: Partial<Parameters<typeof makeWorkoutDetail>[0]> = {}): WorkoutDetail =>
  makeWorkoutDetail({
    startedAt: STARTED,
    exercises: [
      {
        modality: "weight_reps",
        name: "Bench",
        sets: [
          makeSet({ setNumber: 1, completedAt: "2026-11-08T09:10:00.000Z" }),
          makeSet({ setNumber: 2, completedAt: "2026-11-08T09:20:00.000Z" }),
        ],
      },
    ],
    ...over,
  });

const finishOp = (workout: WorkoutDetail, status: FinishOp["status"] = "queued", endedAt = ENDED): FinishOp => ({
  id: `finish-${status}`,
  workoutId: workout.id,
  userId: "u",
  status,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "finish",
  body: { endedAt },
  meta: { startedAt: workout.startedAt, exerciseCount: 1, setCount: 2, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
});

describe("06.7 AC16 — withQueuedFinish: the finished copy a waiting finish projects (pure half)", () => {
  it("FINISH_WAIT_MS is eight seconds (§3, D7)", () => {
    expect(FINISH_WAIT_MS).toBe(8_000);
  });

  it.each(["queued", "sending"] as const)("a %s finish op sets endedAt to the op's", (status) => {
    const workout = live();
    const out = withQueuedFinish(workout, [finishOp(workout, status)]);
    expect(out.endedAt).toBe(ENDED);
  });

  it("a failed finish op, or none, returns the workout unchanged", () => {
    const workout = live();
    expect(withQueuedFinish(workout, [finishOp(workout, "failed")])).toBe(workout);
    expect(withQueuedFinish(workout, [])).toBe(workout);
  });

  it("another workout's finish op is ignored", () => {
    const workout = live();
    const other = live();
    expect(withQueuedFinish(workout, [finishOp(other)])).toBe(workout);
  });

  it("set, note and timer ops of the workout are not a finish", () => {
    const workout = live();
    const note: OutboxOp = {
      id: "n",
      workoutId: workout.id,
      workoutExerciseId: workout.exercises[0]!.id,
      userId: "u",
      status: "queued",
      attempted: false,
      attempts: 0,
      nextAttemptAt: 0,
      enqueuedAt: 0,
      kind: "note",
      body: { notes: "x" },
    };
    expect(withQueuedFinish(workout, [note])).toBe(workout);
  });

  it("clears plannedDurationSeconds, as the server's finish does (apps/api CLAUDE.md, Spec 07.4)", () => {
    const workout = live({ plannedDurationSeconds: 4500 });
    expect(withQueuedFinish(workout, [finishOp(workout)]).plannedDurationSeconds).toBeNull();
  });

  it("a one-off routine is no longer one (the finish removes or keeps it either way, Spec 09.3)", () => {
    const workout = live({ routineName: "Tuesday", routineIsOneOff: true });
    expect(withQueuedFinish(workout, [finishOp(workout)]).routineIsOneOff).toBe(false);
  });

  it("clamps a set's completedAt into [startedAt, endedAt], as the finish's clampSetTimes does", () => {
    const workout = live();
    const early = "2026-11-08T09:15:00.000Z";
    const out = withQueuedFinish(workout, [finishOp(workout, "queued", early)]);
    expect(out.exercises[0]!.sets.map((s) => s.completedAt)).toEqual(["2026-11-08T09:10:00.000Z", early]);
  });

  it("leaves an incomplete set's completedAt null", () => {
    const workout = live({ exercises: [{ modality: "weight_reps", sets: [makeSet({ isComplete: false, completedAt: null, reps: null })] }] });
    expect(withQueuedFinish(workout, [finishOp(workout)]).exercises[0]!.sets[0]!.completedAt).toBeNull();
  });

  it("the result parses as a WorkoutDetail and reads the same stats as after a real finish", () => {
    const workout = live({ plannedDurationSeconds: 600 });
    const out = withQueuedFinish(workout, [finishOp(workout)]);
    expect(WorkoutDetailSchema.parse(out)).toEqual(out);
    const server: WorkoutDetail = { ...workout, endedAt: ENDED, plannedDurationSeconds: null };
    expect(finishStatsFor(out, out.endedAt!)).toEqual(finishStatsFor(server, server.endedAt!));
  });
});
