import { ExerciseSchema, type Exercise } from "@sin/core";

/** A deterministic, schema-valid exercise id: `…-000000000007` for `n = 7`. */
export const exerciseId = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A schema-valid `Exercise`; pass only the fields a test cares about. */
export function makeExercise(
  overrides: Partial<Record<keyof Exercise, unknown>> = {},
): Exercise {
  return ExerciseSchema.parse({
    id: exerciseId(1),
    catalogKey: null,
    ownerUserId: null,
    name: "Bench Press",
    modality: "weight_reps",
    primaryMuscleId: "chest",
    secondaryMuscleIds: [],
    equipmentId: "barbell",
    isActive: true,
    forkedFromExerciseId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}
