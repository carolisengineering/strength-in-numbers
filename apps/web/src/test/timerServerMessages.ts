import { TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX } from "@sin/core";

/**
 * The server's own `422` message for a length over its maximum, as the API sends it: `normalizeError` rewrites each
 * Zod issue through `zodIssueMessage` (`apps/api/src/errors/problem.ts`), so `too_big` reads "must be at most N"
 * (minor 316, final review). Never Zod's own text, which only the web's local check sees.
 */
export const ROUND_SECONDS_MAX_MESSAGE = `must be at most ${TIMER_ROUND_SECONDS_MAX}`;
export const CAP_SECONDS_MAX_MESSAGE = `must be at most ${TIMER_CAP_SECONDS_MAX}`;

/** A timer `422` field error as the server sends it for a value over the maximum; any other path gets `other`. */
export const overMaxError = (path: string, other = "SERVER-SECRET"): { path: string; message: string } => ({
  path,
  message: path.endsWith(".roundSeconds") ? ROUND_SECONDS_MAX_MESSAGE : path.endsWith(".capSeconds") ? CAP_SECONDS_MAX_MESSAGE : other,
});
