import type { SetEntry, WorkoutDetail, WorkoutExercise } from "@sin/core";

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

/**
 * Drop a set, named by its id or by its `clientGeneratedId` (Spec 06.2: a sheet opened on a pending set
 * still holds the client key after the row took its server id). Exercises it was not in keep reference
 * equality. Pure.
 */
export function withSetRemoved(detail: WorkoutDetail, setId: string): WorkoutDetail {
  const named = (s: SetEntry) => s.id === setId || s.clientGeneratedId === setId;
  if (!detail.exercises.some((e) => e.sets.some(named))) return detail;
  return {
    ...detail,
    exercises: detail.exercises.map((e) => (e.sets.some(named) ? { ...e, sets: e.sets.filter((s) => !named(s)) } : e)),
  };
}

/** Write a note edit's result into the cached workout: only `notes` and `updatedAt` change (Spec 10.3 AC28). Pure. */
export function withExerciseNotes(detail: WorkoutDetail, exercise: Pick<WorkoutExercise, "id" | "notes" | "updatedAt">): WorkoutDetail {
  const current = detail.exercises.find((e) => e.id === exercise.id);
  if (!current || (current.notes === exercise.notes && current.updatedAt === exercise.updatedAt)) return detail;
  return {
    ...detail,
    exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, notes: exercise.notes, updatedAt: exercise.updatedAt } : e)),
  };
}
