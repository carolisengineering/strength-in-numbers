/**
 * Spec 16, minors PR I — the limits every Grafana and Auth0 call shares, so a hung or slow service can't stall a
 * staging run. The API's `/healthz` read keeps no timeout: a Render cold start can take longer than this.
 */

/** Minor 585: a Grafana or Auth0 call gives up after this long (undici's own default is about 5 minutes). */
export const CALL_TIMEOUT_MS = 10_000;

/** A fresh timeout signal for one `fetch`. */
export function callSignal(): AbortSignal {
  return AbortSignal.timeout(CALL_TIMEOUT_MS);
}
