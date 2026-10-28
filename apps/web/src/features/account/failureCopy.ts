import { ApiError } from "../../api/problem";
import { waitText } from "../../ui/waitText";
import { MESSAGES } from "./messages";

export interface FailureCopy {
  readonly text: string;
  readonly requestId?: string;
}

function map(error: unknown, rateLimited: string, generic: string): FailureCopy {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return { text: MESSAGES.offline };
    if (error.status === 429) return { text: `${rateLimited} ${waitText(error.retryAfterMs)}` };
    return { text: generic, requestId: error.requestId };
  }
  return { text: generic };
}

/** Spec 12 AC9 — static copy plus the request id; the response body is never echoed. */
export const exportFailure = (error: unknown): FailureCopy =>
  map(error, MESSAGES.tooManyDownloads, MESSAGES.exportFailed);

/** Spec 12 AC19. */
export const deleteFailure = (error: unknown): FailureCopy =>
  map(error, MESSAGES.tooManyAttempts, MESSAGES.deleteFailed);
