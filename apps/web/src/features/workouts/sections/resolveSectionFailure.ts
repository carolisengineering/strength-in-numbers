import { ApiError } from "../../../api";
import { classifyWorkoutError } from "../errors";
import { SECTION_COPY, rateLimited } from "./sectionCopy";

export type SectionOp = "add-section" | "update-section" | "remove-section" | "set-section";

export type SectionFailure =
  | { type: "offline"; text: string }
  | { type: "rate-limited"; text: string }
  | { type: "fields"; name: string | null; notes: string | null }
  | { type: "limit"; text: string }
  /** A 404 on update or move: the caller refetches to tell a missing section from a missing workout. */
  | { type: "missing" }
  /** A 404 on add: the workout itself is gone. */
  | { type: "workout-gone" }
  /** A 404 on remove: the section is already gone, which is what was asked. */
  | { type: "done" }
  | { type: "unconfirmed"; text: string; requestId: string | null }
  | { type: "retry"; text: string; requestId: string | null; offerRetry: boolean };

const RETRY_TEXT = {
  "update-section": SECTION_COPY.saveFailed,
  "remove-section": SECTION_COPY.removeFailed,
  "set-section": SECTION_COPY.moveFailed,
} as const;

/**
 * Spec 10.6 AC13 — one failure table for the four section writes, decided from the status and the
 * problem slug only, never from message text. `report` says whether the caller should call
 * `reportUnexpected` (an unknown kind that is not a rate limit).
 */
export function resolveSectionFailure(
  op: SectionOp,
  error: unknown,
  options: { offlineText: string },
): SectionFailure & { report: boolean } {
  const { kind, requestId, fieldErrors } = classifyWorkoutError(error, { op });
  const status = error instanceof ApiError ? error.status : null;
  if (kind === "network") return { type: "offline", text: options.offlineText, report: false };
  if (status === 429) {
    const retryAfterMs = error instanceof ApiError ? (error.retryAfterMs ?? null) : null;
    return { type: "rate-limited", text: rateLimited(retryAfterMs), report: false };
  }
  // A move or a remove has no fields the lifter typed: its 422 is the op's generic failure.
  if (kind === "validation" && (op === "add-section" || op === "update-section")) {
    const has = (path: string) => fieldErrors.some((e) => e.path === path);
    return {
      type: "fields",
      name: has("name") ? SECTION_COPY.fieldsGeneric : null,
      notes: has("notes") ? SECTION_COPY.fieldsGeneric : null,
      report: false,
    };
  }
  if (kind === "workout-section-limit" && op === "add-section") {
    return { type: "limit", text: SECTION_COPY.limit, report: false };
  }
  if (kind === "not-found") {
    if (op === "add-section") return { type: "workout-gone", report: false };
    if (op === "remove-section") return { type: "done", report: false };
    return { type: "missing", report: false };
  }
  const report = kind === "unknown";
  if (op === "add-section") return { type: "unconfirmed", text: SECTION_COPY.addUnconfirmed, requestId, report };
  return { type: "retry", text: RETRY_TEXT[op], requestId, offerRetry: op !== "update-section", report };
}
