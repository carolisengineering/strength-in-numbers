import { formatLocalDate } from "../workouts/format";

/**
 * `"2026-10-06"` → `"Tue 6 Oct 2026"`: the readout and sessions rows, where All can repeat a day-month
 * (D9). Built from 08.0's pinned formatter plus the year: ICU's own year pattern inserts a comma.
 */
export function formatLocalDateWithYear(localDate: string): string {
  return `${formatLocalDate(localDate)} ${localDate.slice(0, 4).replace(/^0+(?=\d)/, "")}`;
}

/** The device's local calendar date, `YYYY-MM-DD` — the default `ProgressClockContext` value (§6.1). */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
