import type { Routine } from "@sin/core";
import { oneOffMetaText, oneOffNoteText } from "./messages";
import { routineSummary } from "./targetFormat";

/**
 * Spec 10.5 §6.1 — the one place that decides "is one-off", the expiry day and the list / preview wording.
 * "from text" is literal: 10.4's import Save is the only creator of one-offs (Spec 09.3 D13).
 */
export const isOneOff = (r: Pick<Routine, "oneOffUntil">): boolean => r.oneOffUntil !== null;

const DAY_OPTIONS = { weekday: "short", day: "numeric", month: "short" } as const;
const DEVICE_DAY = new Intl.DateTimeFormat("en-GB", DAY_OPTIONS);

/** "Fri 30 Oct": the expiry instant in the device's zone (an instant, not a stored calendar date). `timeZone` pins it for tests. */
export function oneOffDay(iso: string, options: { timeZone?: string } = {}): string {
  const format =
    options.timeZone === undefined ? DEVICE_DAY : new Intl.DateTimeFormat("en-GB", { ...DAY_OPTIONS, timeZone: options.timeZone });
  return format.format(new Date(iso));
}

/** The expiry day, or null once it has passed (only while a live workout holds the routine, Spec 09.3 AC20). */
function dayUnlessPast(until: string, now: number): string | null {
  return Date.parse(until) <= now ? null : oneOffDay(until);
}

/** The list row's meta line; an ordinary routine's is just its summary. */
export function oneOffMeta(routine: Routine, now: number): string {
  if (routine.oneOffUntil === null) return routineSummary(routine);
  return oneOffMetaText(routineSummary(routine), dayUnlessPast(routine.oneOffUntil, now));
}

/** The preview note of a one-off (AC6), or its reduced form past expiry (AC4); an ordinary routine has none. */
export function oneOffNote(routine: Routine, now: number): string | null {
  if (routine.oneOffUntil === null) return null;
  return oneOffNoteText(dayUnlessPast(routine.oneOffUntil, now));
}
