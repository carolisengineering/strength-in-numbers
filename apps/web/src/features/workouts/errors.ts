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
  /** The operation the caller named (a static string, safe for a `reportError` tag), or null. */
  readonly op: string | null;
}

const NO_FIELDS: readonly FieldError[] = [];

function classified(kind: WorkoutErrorKind, op: string | null, error?: ApiError): ClassifiedError {
  return { kind, op, requestId: error?.requestId ?? null, fieldErrors: error?.errors ?? NO_FIELDS };
}

/**
 * Maps every error the workout screen can meet to one kind (Spec 06.1 §5.8). The problem slug
 * (`ApiError.type`) decides a 409 — never the title or detail text. Never throws.
 */
export function classifyWorkoutError(error: unknown, context?: { op: string }): ClassifiedError {
  const op = context?.op ?? null;
  if (!(error instanceof ApiError)) return classified("unknown", op);
  if (error.isNetworkError) return classified("network", op, error);
  switch (error.status) {
    case 401:
      return classified("unauthenticated", op, error);
    case 404:
      return classified("not-found", op, error);
    case 422:
      return classified("validation", op, error);
    case 409:
      switch (error.type) {
        case "workout-in-progress-exists":
        case "workout-finished":
        case "incomplete-working-sets":
        case "exercise-retired":
          return classified(error.type, op, error);
        default:
          return classified("unknown", op, error);
      }
    default:
      return error.status >= 500 ? classified("server", op, error) : classified("unknown", op, error);
  }
}
