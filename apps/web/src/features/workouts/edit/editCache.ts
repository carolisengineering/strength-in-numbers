import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";

/**
 * Spec 18.0 §6.5 "Merging", pure: a `PATCH /v1/workouts/{id}` answers a `Workout` (no exercises) plus `newRecords`;
 * merge the workout's own fields into the cached detail and keep its exercises, sections and routine notes.
 */
export function mergeWorkout(detail: WorkoutDetail, updated: UpdatedWorkout): WorkoutDetail {
  const merged: WorkoutDetail & { newRecords?: unknown } = { ...detail, ...updated };
  delete merged.newRecords; // a records list is not part of the detail
  return merged;
}
