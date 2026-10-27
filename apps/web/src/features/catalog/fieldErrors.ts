import type { ApiError } from "../../api/problem";
import type { ExerciseFieldName } from "./ExerciseFields";

/** The custom-exercise cap's text (Spec 06.0 AC28): the create form and the copy (Spec 18.2 AC45) share it. */
export const EXERCISE_LIMIT_MESSAGE = "You've reached the maximum number of custom exercises.";

const FIELD_NAMES: readonly ExerciseFieldName[] = ["name", "modality", "primaryMuscleId", "secondaryMuscleIds", "equipmentId"];
const isFieldName = (value: string): value is ExerciseFieldName => (FIELD_NAMES as readonly string[]).includes(value);

/** The fields rendered inside "More details". */
const DETAIL_FIELDS: readonly ExerciseFieldName[] = ["primaryMuscleId", "secondaryMuscleIds", "equipmentId"];

/**
 * A `422` onto the exercise fields (Spec 06.0 AC29; shared with Spec 18.2's Edit sheet, AC42): each message under its
 * field, the rest as the form message, and `openDetails` when a message lands under the collapsed "More details".
 */
export function mapExerciseFieldErrors(error: ApiError): {
  fieldErrors: Partial<Record<ExerciseFieldName, string>>;
  formError: string | undefined;
  openDetails: boolean;
} {
  const fieldErrors: Partial<Record<ExerciseFieldName, string>> = {};
  const unplaced: string[] = [];
  for (const { path, message } of error.errors) {
    // The API joins nested paths with "." (`secondaryMuscleIds.0`).
    const field = path.split(".")[0] ?? "";
    if (isFieldName(field)) fieldErrors[field] ??= message;
    else unplaced.push(message);
  }
  const formError =
    unplaced.length > 0 || error.errors.length === 0 ? unplaced.join(" ") || "Some of these values were not accepted." : undefined;
  return { fieldErrors, formError, openDetails: DETAIL_FIELDS.some((field) => fieldErrors[field] !== undefined) };
}
