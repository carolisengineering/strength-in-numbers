import type { SetEntry, WorkoutDetail } from "@sin/core";

const bySetNumber = (a: SetEntry, b: SetEntry): number => a.setNumber - b.setNumber;

/** Replace the set with the same id, or insert it; sets stay ordered by `setNumber`. Pure. */
export function withSetUpserted(detail: WorkoutDetail, set: SetEntry): WorkoutDetail {
  if (!detail.exercises.some((e) => e.id === set.workoutExerciseId)) return detail;
  return {
    ...detail,
    exercises: detail.exercises.map((e) =>
      e.id === set.workoutExerciseId
        ? { ...e, sets: [...e.sets.filter((s) => s.id !== set.id), set].sort(bySetNumber) }
        : e,
    ),
  };
}

/** Drop a set; exercises it was not in keep reference equality. Pure. */
export function withSetRemoved(detail: WorkoutDetail, setId: string): WorkoutDetail {
  if (!detail.exercises.some((e) => e.sets.some((s) => s.id === setId))) return detail;
  return {
    ...detail,
    exercises: detail.exercises.map((e) =>
      e.sets.some((s) => s.id === setId) ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e,
    ),
  };
}
