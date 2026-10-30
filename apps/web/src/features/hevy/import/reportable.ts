import { ApiError } from "../../../api";

/**
 * Spec 20.1 §9: the one rule for which import failures go to `reportError` — anything but a network error or a
 * `4xx` (an `ImportReplyError`, a `5xx`, anything unexpected). The dry run, the run, the finish and the routines all
 * use it.
 */
export function reportable(err: unknown): boolean {
  return !(err instanceof ApiError && (err.isNetworkError || (err.status >= 400 && err.status < 500)));
}
