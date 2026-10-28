/**
 * Spec 20.0 AC9: what went wrong talking to Hevy, as a kind. A `HevyError` carries nothing from Hevy's reply (its
 * error text can echo the request, Review Focus 5) and no `cause` (a cause could hold a request with the key): its
 * `message` is fixed text and the screen shows `HEVY_COPY[kind]`. React-free.
 */

export type HevyErrorKind =
  | "bad_key"
  | "limit"
  | "rate_limited"
  | "rejected"
  | "not_found"
  | "server"
  | "network"
  | "unexpected_reply"
  | "aborted";

export class HevyError extends Error {
  readonly kind: HevyErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: HevyErrorKind, opts: { status?: number | null; retryAfterMs?: number | null } = {}) {
    super(`Hevy request failed: ${kind}`);
    this.name = "HevyError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** Hevy's error text for its custom-exercise cap (20.2 AC14); any other 403 is a key Hevy refused. */
const CUSTOM_EXERCISE_LIMIT = "exceeds-custom-exercise-limit";

/** The kind of a non-2xx reply. The body is read only for the 403 limit text and is then dropped. */
export function classifyHevyResponse(status: number, body: unknown): HevyErrorKind {
  if (status === 401) return "bad_key";
  if (status === 403) {
    const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    return error === CUSTOM_EXERCISE_LIMIT ? "limit" : "bad_key";
  }
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "rejected";
}

/** `Retry-After` in milliseconds from `nowMs`: whole seconds or an HTTP date (a past date is 0); else `null`. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}
