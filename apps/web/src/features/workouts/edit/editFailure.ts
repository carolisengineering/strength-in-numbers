import { classifyWorkoutError, type FieldError } from "../errors";
import { EDIT_COPY } from "./editCopy";

export type EditOperation =
  | "create-set"
  | "update-set"
  | "delete-set"
  | "add-exercise"
  | "move-exercise"
  | "regroup"
  | "remove-exercise"
  | "update-note"
  | "update-details"
  | "delete-workout";

/** What the edit screen does about a failed write: one variant per way §5.4 can resolve. */
export type EditFailure =
  /** A delete's 404: it had already happened. */
  | { type: "done" }
  /** `409 workout-would-be-empty` on a delete: offer to delete the whole workout (AC18). */
  | { type: "last-set" }
  /** A 404 on a set / exercise route: refetch, then the vanished view or `text`. */
  | { type: "missing"; text: string }
  /** The workout itself is gone (AC20). */
  | { type: "vanished" }
  /** Move / regroup: the screen's copy is stale; refetch quietly. */
  | { type: "refetch" }
  | { type: "fields"; fieldErrors: readonly FieldError[]; fallback: string; requestId: string | null }
  | { type: "retired" }
  /** Add-exercise 404: refetch to tell "workout gone" from "exercise not visible". */
  | { type: "unavailable" }
  /** Add-exercise, ambiguous: refetch and ask the lifter to check (no idempotency key, no retry). */
  | { type: "unconfirmed"; text: string; requestId: string | null }
  /** `retry` is true exactly where §5.4 offers **Try again**. */
  | { type: "message"; text: string; requestId: string | null; retry: boolean };

/** Ops whose banner offers Try again (idempotent, outside a sheet). */
const BANNER_RETRY: ReadonlySet<EditOperation> = new Set(["move-exercise", "remove-exercise", "delete-workout"]);

function otherText(op: EditOperation): string {
  switch (op) {
    case "delete-workout":
      return EDIT_COPY.deleteFailed;
    case "add-exercise":
      return EDIT_COPY.unconfirmed;
    default:
      return EDIT_COPY.retry[op];
  }
}

/**
 * Spec 18.0 §5.4 as one pure function. Decides by status and problem slug only — never by the error's
 * text, so nothing the server says reaches the screen.
 */
export function resolveEditFailure(op: EditOperation, error: unknown): EditFailure {
  const { kind, requestId, fieldErrors } = classifyWorkoutError(error, { op });
  const retry = BANNER_RETRY.has(op);
  const other: EditFailure = { type: "message", text: otherText(op), requestId, retry };

  // Offline: the sheet's own submit is its retry; add-exercise has no key, so no Try again (AC17).
  if (kind === "network") return { type: "message", text: EDIT_COPY.offline, requestId, retry };

  switch (op) {
    case "create-set":
    case "update-set":
      if (kind === "not-found") return { type: "missing", text: op === "create-set" ? EDIT_COPY.exerciseMissing : EDIT_COPY.setMissing };
      if (kind === "validation") return { type: "fields", fieldErrors, fallback: EDIT_COPY.fieldsFallback[op], requestId };
      return other;
    case "delete-set":
    case "remove-exercise":
      if (kind === "not-found") return { type: "done" };
      if (kind === "workout-would-be-empty") return { type: "last-set" };
      return other;
    case "add-exercise":
      if (kind === "not-found") return { type: "unavailable" };
      if (kind === "exercise-retired") return { type: "retired" };
      return { type: "unconfirmed", text: EDIT_COPY.unconfirmed, requestId };
    case "move-exercise":
    case "regroup":
      if (kind === "not-found" || kind === "validation") return { type: "refetch" };
      return other;
    case "update-note":
      if (kind === "not-found") return { type: "missing", text: EDIT_COPY.exerciseMissing };
      if (kind === "validation") return { type: "fields", fieldErrors, fallback: EDIT_COPY.retry["update-note"], requestId };
      return other;
    case "update-details":
      if (kind === "not-found") return { type: "vanished" };
      if (kind === "validation") return { type: "fields", fieldErrors, fallback: EDIT_COPY.fieldsFallback["update-details"], requestId };
      return other;
    case "delete-workout":
      if (kind === "not-found") return { type: "done" };
      return other;
  }
}
