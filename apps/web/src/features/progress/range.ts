/** The chart's time window (Spec 08.1 AC1, D7). Pure string arithmetic: no `Date`, so no zone or DST input. */
export type Range = "3m" | "1y" | "all";

export const RANGES: readonly Range[] = ["3m", "1y", "all"];

export const RANGE_CHIP: Record<Range, string> = { "3m": "3M", "1y": "1Y", all: "All" };

const MONTHS_BACK: Record<Exclude<Range, "all">, number> = { "3m": 3, "1y": 12 };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const daysInMonth = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS[m - 1]!);
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * The inclusive lower bound (`from`) for `range`, `today` minus whole calendar months; a day past the
 * target month's end clamps to its last day (31 May − 3 months = 28 Feb). `all` has no bound.
 */
export function rangeStart(today: string, range: Range): string | undefined {
  if (range === "all") return undefined;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - MONTHS_BACK[range];
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return `${pad(ty, 4)}-${pad(tm)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}

export function rangeLabel(range: Range): string {
  return range === "3m" ? "3 months" : range === "1y" ? "1 year" : "all time";
}

export function emptyRangeText(range: Range): string {
  return range === "3m" ? "No sessions in the last 3 months" : range === "1y" ? "No sessions in the last year" : "No sessions yet";
}
