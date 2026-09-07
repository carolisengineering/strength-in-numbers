/**
 * Request-id seam (Spec 04.0 §6.4 / §8.1, AC11).
 *
 * A fresh id per logical API request, sent as `X-Request-Id`. The API accepts it
 * when it matches `^[A-Za-z0-9._-]{1,128}$` (a v4 UUID does), echoes it on the
 * `x-request-id` response header, and uses it as the problem+json `instance`
 * field — so a user-reported failure correlates to a server log line.
 *
 * Pure: the only ambient dependency is the WHATWG `crypto` global (Q13 —
 * React-free, DOM-free beyond `fetch` / `crypto.randomUUID`).
 */

export const REQUEST_ID_HEADER = "X-Request-Id";

export function newRequestId(): string {
  return crypto.randomUUID();
}
