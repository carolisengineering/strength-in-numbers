import type { RoutineWriteFields } from "../../src/repositories/routine.js";

/** Spec 09 §10 — a routine body with items from the given exercise ids. */
export function routineFixture(
  exerciseIds: string[],
  over: Partial<RoutineWriteFields> = {},
): RoutineWriteFields {
  return {
    name: over.name ?? "Push A",
    notes: over.notes ?? null,
    items:
      over.items ??
      exerciseIds.map((exerciseId, i) => ({
        exerciseId,
        targetSets: 4,
        targetRepsLow: 6,
        targetRepsHigh: 8,
        targetRpe: 8.5,
        restSeconds: 90,
        supersetGroup: null,
        notes: i === 0 ? "first" : null,
      })),
  };
}

export const TRUNCATE_ROUTINES =
  'TRUNCATE "personal_record", "set_entry", "workout_exercise", "workout", "routine_item", "routine", "exercise", "user" CASCADE';
