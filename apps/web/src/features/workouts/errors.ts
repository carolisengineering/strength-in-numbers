import { ApiError } from "../../api";

export type WorkoutErrorKind =
  | "not-found"
  | "workout-in-progress-exists"
  | "workout-finished"
  | "incomplete-working-sets"
  | "exercise-retired"
  | "validation"
  | "unauthenticated"
  | "network"
  | "server"
  | "unknown";

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export interface ClassifiedError {
  readonly kind: WorkoutErrorKind;
  readonly requestId: string | null;
  readonly fieldErrors: readonly FieldError[];
}

const NO_FIELDS: readonly FieldError[] = [];

function classified(kind: WorkoutErrorKind, error?: ApiError): ClassifiedError {
  return { kind, requestId: error?.requestId ?? null, fieldErrors: error?.errors ?? NO_FIELDS };
}

/**
 * Maps every error the workout screen can meet to one kind (Spec 06.1 §5.8). The problem slug
 * (`ApiError.type`) decides a 409 — never the title or detail text. Never throws.
 */
export function classifyWorkoutError(error: unknown, _context?: { op: string }): ClassifiedError {
  if (!(error instanceof ApiError)) return classified("unknown");
  if (error.isNetworkError) return classified("network", error);
  switch (error.status) {
    case 401:
      return classified("unauthenticated", error);
    case 404:
      return classified("not-found", error);
    case 422:
      return classified("validation", error);
    case 409:
      switch (error.type) {
        case "workout-in-progress-exists":
        case "workout-finished":
        case "incomplete-working-sets":
        case "exercise-retired":
          return classified(error.type, error);
        default:
          return classified("unknown", error);
      }
    default:
      return error.status >= 500 ? classified("server", error) : classified("unknown", error);
  }
}
