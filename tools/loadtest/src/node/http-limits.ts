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

/** Minor 587: the longest Auth0 `Retry-After` the tools honor; a larger one waits this long, and says so. */
export const RETRY_AFTER_CAP_S = 60;

/**
 * How long to wait before a retry: a positive whole-or-decimal `Retry-After` in seconds, capped at
 * `RETRY_AFTER_CAP_S`, with one line saying how long Auth0 asked for; anything else (missing, `0`, negative, an
 * HTTP-date) is `fallbackS`, with no line.
 */
export function retryAfterWaitMs(header: string | null, fallbackS: number, log: (line: string) => void): number {
  const asked = Number(header);
  if (header === null || !Number.isFinite(asked) || asked <= 0) return fallbackS * 1000;
  if (asked > RETRY_AFTER_CAP_S) {
    log(`Auth0 asked to wait ${asked} s; waiting ${RETRY_AFTER_CAP_S} s`);
    return RETRY_AFTER_CAP_S * 1000;
  }
  log(`Auth0 asked to wait ${asked} s`);
  return asked * 1000;
}

/**
 * Minor 589: Auth0's fixed error code from an answer body, as " <code>" (`errorCode` first, as the Management API sends
 * it, then `error`), or "" when there is none. Only a plain code (`^[a-z0-9_]{1,64}$`; the Management API's weak-password
 * answer is `auth0_idp_error`): a description or message is free text and could echo input, so it never appears. The
 * one exception is a fixed tag: a message that starts with Auth0's `PasswordStrengthError` adds " (password policy)",
 * because `auth0_idp_error` alone doesn't say why (final review; the Auth0 SDKs match the same prefix).
 */
export function auth0ErrorCode(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const { errorCode, error, message } = body as { errorCode?: unknown; error?: unknown; message?: unknown };
  const policy = typeof message === "string" && message.startsWith("PasswordStrengthError") ? " (password policy)" : "";
  for (const code of [errorCode, error]) if (typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code)) return ` ${code}${policy}`;
  return policy;
}
