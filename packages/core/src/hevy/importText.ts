import type { CodeCount } from "../dto/hevy-import.js";
import { WORKOUT_FUTURE_SKEW_MAX_MS, WORKOUT_START_EDIT_FLOOR } from "../dto/workout.js";
import { localDateFor } from "../time.js";

/**
 * Spec 19.1 AC2, AC8: the import's text and time rules. No `Intl` (AC14): cuts count UTF-16 units, as SIN's limits
 * do, and step by whole code points, so a cut never leaves half a surrogate pair.
 */

/** At most `max` UTF-16 units, by whole code points; a cut text loses its trailing whitespace. */
export function cutCodePoints(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  let out = "";
  for (const point of text) {
    if (out.length + point.length > max) break;
    out += point;
  }
  return { text: out.trimEnd(), cut: true };
}

const isControl = (code: number, keepWhitespace: boolean): boolean =>
  (code <= 0x1f || code === 0x7f) && !(keepWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d));

function stripControls(raw: string, keepWhitespace: boolean): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (!isControl(raw.charCodeAt(i), keepWhitespace)) out += raw[i];
  }
  return out;
}

function clean(raw: string | null, max: number, keepWhitespace: boolean): { value: string | null; cut: boolean } {
  if (raw === null) return { value: null, cut: false };
  const trimmed = stripControls(raw, keepWhitespace).trim();
  if (trimmed === "") return { value: null, cut: false };
  const { text, cut } = cutCodePoints(trimmed, max);
  return { value: text, cut };
}

/** A one-line text (a title, a name): every C0 character and DEL removed, trimmed, cut; empty is `null`. */
export function cleanLine(raw: string | null, max: number): { value: string | null; cut: boolean } {
  return clean(raw, max, false);
}

/** A note: as `cleanLine` but TAB, LF and CR are kept, and only the ends are trimmed. */
export function cleanNotes(raw: string | null, max: number): { value: string | null; cut: boolean } {
  return clean(raw, max, true);
}

/** Counts codes; `list()` is in the declared order with zero counts left out. */
export class CodeCounter<C extends string> {
  private readonly counts = new Map<C, number>();

  constructor(private readonly order: readonly C[]) {}

  add(code: C, n = 1): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + n);
  }

  list(): CodeCount<C>[] {
    return this.order.flatMap((code) => {
      const count = this.counts.get(code) ?? 0;
      return count > 0 ? [{ code, count }] : [];
    });
  }
}

const FLOOR_MS = Date.parse(WORKOUT_START_EDIT_FLOOR);

/**
 * AC2: the stored times, or `ok: false` when the end is before the start, either does not parse, the start is before
 * the floor, or the end is more than `WORKOUT_FUTURE_SKEW_MAX_MS` after `now` (inclusive bound).
 */
export function importTimes(
  w: { startTime: string; endTime: string; tzOffsetMinutes: number },
  now: Date,
): { ok: true; startedAt: string; endedAt: string; localDate: string } | { ok: false } {
  const start = Date.parse(w.startTime);
  const end = Date.parse(w.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false };
  if (end < start || start < FLOOR_MS || end > now.getTime() + WORKOUT_FUTURE_SKEW_MAX_MS) return { ok: false };
  return {
    ok: true,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    localDate: localDateFor(w.startTime, w.tzOffsetMinutes),
  };
}
