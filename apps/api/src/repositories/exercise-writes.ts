import { muscleIdCrossFieldIssues } from "@sin/core";
import { ValidationError, type FieldError } from "../errors/app-error.js";
import type { ExerciseWriteFields, ExerciseWritePatch } from "./exercise.js";

/**
 * Overlays only the keys actually present in `patch` onto `base` (Spec 03.2
 * §5/§6). `"key" in patch` — not `??` — distinguishes an explicit `null` on a
 * nullable field (clear it) from the field being absent (keep the base value);
 * `UpdateExerciseSchema.partial()` omits absent keys entirely rather than
 * setting them to `undefined`, so this check is exact.
 */
export function mergeWritableFields(
  base: ExerciseWriteFields,
  patch: ExerciseWritePatch,
): ExerciseWriteFields {
  return {
    name: "name" in patch ? patch.name! : base.name,
    modality: "modality" in patch ? patch.modality! : base.modality,
    primaryMuscleId:
      "primaryMuscleId" in patch ? patch.primaryMuscleId! : base.primaryMuscleId,
    secondaryMuscleIds:
      "secondaryMuscleIds" in patch
        ? patch.secondaryMuscleIds!
        : base.secondaryMuscleIds,
    equipmentId: "equipmentId" in patch ? patch.equipmentId! : base.equipmentId,
  };
}

/**
 * Re-runs the muscle-id cross-field rule against the *merged* result (Spec
 * 03.2 §6) — a partial body that is valid standalone can still produce an
 * invalid merge (e.g. restating the base row's untouched `primaryMuscleId`).
 * Shared by `PATCH` and the `/fork` overlay.
 *
 * Per D22, the length cap only ever applies to a `secondaryMuscleIds` the
 * caller's own `patch`/overlay actually supplied — never to a value inherited
 * unedited from the base row or fork origin — so `checkLength` is gated on
 * `"secondaryMuscleIds" in patch`, the same presence idiom `mergeWritableFields`
 * uses above. The duplicate-id and restated-`primaryMuscleId` checks are
 * unaffected and always run against the full merged result.
 */
export function assertMergedFieldsValid(
  merged: ExerciseWriteFields,
  patch: ExerciseWritePatch,
): void {
  const issues = muscleIdCrossFieldIssues(merged, {
    checkLength: "secondaryMuscleIds" in patch,
  });
  if (issues.length === 0) return;
  const fieldErrors: FieldError[] = issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw new ValidationError(
    fieldErrors,
    "merged exercise fields fail the muscle-id cross-field check",
  );
}
