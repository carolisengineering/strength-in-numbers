import { ApiError, type ProblemFieldError } from "../../api";

export type RoutineErrorKind =
  | "name-taken"
  | "limit"
  | "retired"
  | "validation"
  | "not-found"
  | "rate-limited"
  | "network"
  | "unauthenticated"
  | "server"
  | "unknown";

export interface ClassifiedRoutineError {
  readonly kind: RoutineErrorKind;
  readonly requestId: string | null;
  readonly fieldErrors: readonly ProblemFieldError[];
  /** For `retired`: the indexes named by `items.<i>.exerciseId` paths, in the submitted payload. */
  readonly retiredIndexes: readonly number[];
}

const RETIRED_PATH = /^items\.(\d+)\.exerciseId$/;
const NONE: readonly never[] = [];

function result(kind: RoutineErrorKind, error?: ApiError, retiredIndexes: readonly number[] = NONE): ClassifiedRoutineError {
  return { kind, requestId: error?.requestId ?? null, fieldErrors: error?.errors ?? NONE, retiredIndexes };
}

/**
 * Routine reads/writes → one kind (Spec 10.0 AC11, D12). Keyed on `status` and the problem slug, never
 * on title or detail text. Never throws. The start path keeps `classifyWorkoutError` (§5.6).
 */
export function classifyRoutineError(error: unknown): ClassifiedRoutineError {
  if (!(error instanceof ApiError)) return result("unknown");
  if (error.isNetworkError) return result("network", error);
  switch (error.status) {
    case 401:
      return result("unauthenticated", error);
    case 404:
      return result("not-found", error);
    case 422:
      return result("validation", error);
    case 429:
      return result("rate-limited", error);
    case 409:
      switch (error.type) {
        case "routine-name-taken":
          return result("name-taken", error);
        case "routine-limit":
          return result("limit", error);
        case "exercise-retired": {
          const indexes = error.errors.flatMap((e) => {
            const match = RETIRED_PATH.exec(e.path);
            return match ? [Number(match[1])] : [];
          });
          return result("retired", error, indexes);
        }
        default:
          return result("unknown", error);
      }
    default:
      return error.status >= 500 ? result("server", error) : result("unknown", error);
  }
}
