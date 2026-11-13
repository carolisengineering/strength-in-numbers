import { ApiError, slugFromType } from "../../../api";

/**
 * Minor 329: `409 section-timer-mismatch` means another device changed the section's timer. It is expected, not a bug
 * to report: the screen re-reads and says "This section's timer changed."
 */
export function isTimerMismatch(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && slugFromType(error.type) === "section-timer-mismatch";
}
