import { ApiError } from "../../api";

export type WorkoutErrorKind =
  | "not-found"
  | "workout-in-progress-exists"
  | "workout-finished"
  /** Spec 07.4 / 18.0 AC18: a delete on a finished workout would leave it with no sets. */
  | "workout-would-be-empty"
  | "incomplete-working-sets"
  | "exercise-retired"
  /** Spec 09.4 / 10.6 AC13: a ninth section on a workout. */
  | "workout-section-limit"
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
        case "workout-would-be-empty":
        case "incomplete-working-sets":
        case "exercise-retired":
        case "workout-section-limit":
          return classified(error.type, op, error);
        default:
          return classified("unknown", op, error);
      }
    default:
      return error.status >= 500 ? classified("server", op, error) : classified("unknown", op, error);
  }
}

/** A repeat of an already-applied delete answers 404: it already happened, so the screen treats it as success (minor 68). */
export async function ignoreNotFound(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

/**
 * The workout is gone (its detail answers 404): the one rule the edit screen's vanished view and its section re-read
 * both use (minor 67).
 */
export function isWorkoutGone(error: unknown): boolean {
  return classifyWorkoutError(error, { op: "load-workout" }).kind === "not-found";
}
