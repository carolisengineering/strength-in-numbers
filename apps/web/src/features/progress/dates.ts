import { formatLocalDate } from "../../ui/dateText";

/**
 * `"2026-10-06"` → en-US `"Tue, Oct 6, 2026"`: the readout and sessions rows, where All can repeat a day-month
 * (D9). UTC, like `formatLocalDate`, so the stored day never shifts (Spec 17.13).
 */
export function formatLocalDateWithYear(localDate: string): string {
  return formatLocalDate(localDate, { year: true });
}

/** The device's local calendar date, `YYYY-MM-DD` — the default `ProgressClockContext` value (§6.1). */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
