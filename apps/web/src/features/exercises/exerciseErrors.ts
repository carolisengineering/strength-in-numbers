import { ApiError } from "../../api/problem";
import { EXERCISE_LIMIT_MESSAGE } from "../catalog/fieldErrors";
import { EXERCISES_COPY } from "./messages";

export type ExerciseErrorKind =
  | "type-locked"
  | "limit"
  | "gone"
  | "built-in"
  | "validation"
  | "network"
  | "rate-limited"
  | "unauthenticated"
  | "server"
  | "unknown";

/**
 * An edit, copy or delete failure (Spec 18.2 AC42, AC45), keyed on status and slug, never on the server's text.
 * A 5xx is expected (not reported), as in 08.1; only `unknown` reaches `reportUnexpected`.
 */
export function classifyExerciseError(error: unknown): ExerciseErrorKind {
  if (!(error instanceof ApiError)) return "unknown";
  if (error.isNetworkError) return "network";
  const { status, type } = error;
  if (status === 409 && type === "exercise-type-locked") return "type-locked";
  if (status === 409 && type === "exercise-limit-reached") return "limit";
  if ((status === 409 && type === "exercise-retired") || status === 404) return "gone";
  if ((status === 409 && type === "exercise-immutable-use-fork") || (status === 403 && type === "exercise-immutable")) return "built-in";
  if (status === 422) return "validation";
  if (status === 429) return "rate-limited";
  if (status === 401) return "unauthenticated";
  if (status >= 500) return "server";
  return "unknown";
}

/** The static text for a failure; `null` for `unauthenticated` (`onAuthLost` has started the logout). */
export function exerciseErrorMessage(kind: ExerciseErrorKind, op: "update" | "fork" | "delete"): string | null {
  switch (kind) {
    case "gone":
      return op === "fork" ? EXERCISES_COPY.forkGone : EXERCISES_COPY.alreadyDeleted;
    case "limit":
      return EXERCISE_LIMIT_MESSAGE;
    case "built-in":
      return EXERCISES_COPY.builtInCantEdit;
    case "network":
      return EXERCISES_COPY.offline;
    case "rate-limited":
      return EXERCISES_COPY.tooFast;
    case "unauthenticated":
      return null;
    default:
      return EXERCISES_COPY.couldntSave;
  }
}
