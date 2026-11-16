import type { WorkoutDetail } from "@sin/core";
import { isFinishOp, type FinishOp, type OutboxOp } from "./ops";

/**
 * Spec 06.7 §3, D7: how long the Finish tap waits for its op to land before it says "saved on this phone". Shorter
 * than `SEND_TIMEOUT_MS` on purpose: the request is not canceled when the wait ends, and a late landing still shows.
 */
export const FINISH_WAIT_MS = 8_000;

/** The workout's waiting (queued or sending) finish op, if any; a failed one is a refusal, never applied (AC19). */
export function waitingFinishOf(workoutId: string, ops: readonly OutboxOp[]): FinishOp | undefined {
  return ops.find((o): o is FinishOp => isFinishOp(o) && o.workoutId === workoutId && o.status !== "failed");
}

/**
 * Spec 06.7 §6.2, AC16: the finished copy of a workout whose finish is waiting — what the server's finish will
 * return. It sets `endedAt` to the op's, clears the live-only `plannedDurationSeconds` (Spec 07.4), turns off
 * `routineIsOneOff` (the finish removes a one-off, or keeps it as a routine, Spec 09.3), and pulls each set's
 * `completedAt` into `[startedAt, endedAt]` as the finish's `clampSetTimes` does. Only `QueuedWorkoutClient.getById`
 * calls it: `["workouts","active"]` never holds an unsent finish (D4).
 */
export function withQueuedFinish(workout: WorkoutDetail, ops: readonly OutboxOp[]): WorkoutDetail {
  const op = waitingFinishOf(workout.id, ops);
  if (!op) return workout;
  const { endedAt } = op.body;
  const start = Date.parse(workout.startedAt);
  const end = Date.parse(endedAt);
  const clamp = (at: string | null): string | null => {
    if (at === null) return null;
    const t = Date.parse(at);
    if (t < start) return workout.startedAt;
    if (t > end) return endedAt;
    return at;
  };
  return {
    ...workout,
    endedAt,
    plannedDurationSeconds: null,
    routineIsOneOff: false,
    exercises: workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, completedAt: clamp(s.completedAt) })) })),
  };
}
