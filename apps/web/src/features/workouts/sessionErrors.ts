import { classifyWorkoutError, type FieldError } from "./errors";

export type Operation =
  | "add-exercise"
  | "move-exercise"
  | "remove-exercise"
  | "create-set"
  | "update-set"
  | "delete-set"
  | "finish"
  | "discard";

/** What the screen should do about a failed write. One variant per way the matrix can resolve. */
export type FailureAction =
  /** The workout is gone or finished elsewhere: refetch /active and hand back to Workouts. */
  | { type: "gone"; reason: "gone" | "finished" }
  /** The write had already taken effect (a repeated delete): treat it as success. */
  | { type: "ok" }
  /** The screen's copy is stale: refetch quietly. */
  | { type: "refetch" }
  /** Add-exercise 404: "workout gone" and "exercise not visible" look the same; the caller refetches to tell. */
  | { type: "unavailable" }
  | { type: "retired" }
  /** Add-exercise ambiguous failure: refetch, then ask the lifter to check. There is no retry (no idempotency key). */
  | { type: "unconfirmed"; text: string; requestId: string | null }
  | { type: "fields"; fieldErrors: readonly FieldError[]; requestId: string | null }
  /** A manual retry is safe and offered. */
  | { type: "retry"; text: string; requestId: string | null }
  | { type: "clock"; requestId: string | null }
  | { type: "incomplete" }
  /** Finish 409 workout-finished: fetch the workout; `endedAt` set means our own finish succeeded. */
  | { type: "finished-check" };

const RETRY_TEXT: Record<Operation, string> = {
  "add-exercise": "Couldn't add that exercise — try again",
  "move-exercise": "Couldn't move that exercise — try again",
  "remove-exercise": "Couldn't remove that exercise — try again",
  "create-set": "Couldn't log set — try again",
  "update-set": "Couldn't save the set — try again",
  "delete-set": "Couldn't delete the set — try again",
  finish: "Couldn't finish — try again",
  discard: "Couldn't discard the workout — try again",
};

const UNCONFIRMED_TEXT =
  "Couldn't confirm that exercise was added — check your workout before adding it again";

/**
 * Spec 06.1 §5.8, one function: every error the screen can meet, per operation, resolved to one
 * action. Pure. `401` is the API client's (`onAuthLost`) and `403 account-deleted` the layout gate's;
 * neither reaches here as anything but the generic row. An unrecognised problem is generic — never a
 * guess.
 */
export function resolveFailure(op: Operation, error: unknown): FailureAction {
  const { kind, requestId, fieldErrors } = classifyWorkoutError(error, { op });
  const retry: FailureAction = { type: "retry", text: RETRY_TEXT[op], requestId };
  const finished: FailureAction = { type: "gone", reason: "finished" };

  switch (op) {
    case "add-exercise":
      switch (kind) {
        case "not-found":
          return { type: "unavailable" };
        case "workout-finished":
          return finished;
        case "exercise-retired":
          return { type: "retired" };
        default:
          return { type: "unconfirmed", text: UNCONFIRMED_TEXT, requestId };
      }
    case "move-exercise":
      if (kind === "not-found" || kind === "validation") return { type: "refetch" };
      return kind === "workout-finished" ? finished : retry;
    case "remove-exercise":
    case "delete-set":
    case "discard":
      if (kind === "not-found") return { type: "ok" };
      return kind === "workout-finished" && op !== "discard" ? finished : retry;
    case "create-set":
    case "update-set":
      if (kind === "not-found") return { type: "gone", reason: "gone" };
      if (kind === "workout-finished") return finished;
      return kind === "validation" ? { type: "fields", fieldErrors, requestId } : retry;
    case "finish":
      if (kind === "not-found") return { type: "gone", reason: "gone" };
      if (kind === "incomplete-working-sets") return { type: "incomplete" };
      if (kind === "workout-finished") return { type: "finished-check" };
      return kind === "validation" ? { type: "clock", requestId } : retry;
  }
}
