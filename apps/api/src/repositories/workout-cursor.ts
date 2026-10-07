/**
 * The `GET /v1/workouts` cursor — Spec 07.1 §6.2, the reference pattern for
 * every later paginated list. A cursor is the POSITION of the last row
 * returned, `(started_at, id)`, as an opaque `v1.` token. `started_at` travels
 * as UTC text produced by Postgres (`to_char(... .US"Z")`) and is never parsed
 * into a JS Date for use: Date holds milliseconds, `timestamptz(6)` holds
 * microseconds, and a millisecond round-trip can skip or repeat a row at a
 * page boundary. (`isRealTimestamp` below only VALIDATES the text.)
 *
 * Not signed (D10): the query is scoped by the authenticated user, so a forged
 * cursor can only choose a position within the caller's own rows.
 */
import { ValidationError } from "../errors/app-error.js";

export const WORKOUT_CURSOR_PREFIX = "v1.";
export const WORKOUT_CURSOR_MAX_LENGTH = 256;

export interface WorkoutCursor {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ`, exactly as Postgres formatted it. */
  startedAtText: string;
  id: string;
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function invalid(): never {
  throw new ValidationError([{ path: "cursor", message: "not a valid cursor" }], "invalid workout cursor");
}

/** The shape matched AND the calendar fields name a real instant — so the
 * `::timestamptz` cast downstream cannot throw (Review Focus 1). */
function isRealTimestamp(s: string): boolean {
  const m = TIMESTAMP.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi &&
    t.getUTCSeconds() === se
  );
}

export function encodeWorkoutCursor(c: WorkoutCursor): string {
  return WORKOUT_CURSOR_PREFIX + Buffer.from(JSON.stringify({ s: c.startedAtText, i: c.id })).toString("base64url");
}

/** Strict decode (§6.2 item 5); any failure is a 422 on `cursor`, before any query. */
export function decodeWorkoutCursor(token: string): WorkoutCursor {
  if (token.length > WORKOUT_CURSOR_MAX_LENGTH || !token.startsWith(WORKOUT_CURSOR_PREFIX)) invalid();
  const body = token.slice(WORKOUT_CURSOR_PREFIX.length);
  if (!BASE64URL.test(body)) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    invalid();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid();
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== "i" || keys[1] !== "s") invalid();
  const { s, i } = parsed as Record<string, unknown>;
  if (typeof s !== "string" || typeof i !== "string") invalid();
  if (!isRealTimestamp(s) || !UUID.test(i)) invalid();
  return { startedAtText: s, id: i };
}
