import { kgToLb, type ProgressPoint, type ProgressSeries, type RecordUnit, type UnitPreference } from "@sin/core";
import { formatRecordValue, roundedE1rm } from "../units/format";
import { rangeLabel, type Range } from "./range";

/** The chartable metrics (Spec 08.1 AC2; Spec 18.1 AC31 adds the last three), in display order. */
export type Metric = "est1rm" | "topSet" | "volume" | "reps" | "calories" | "distance" | "duration";
type MetricField = "bestE1rm" | "topSetWeight" | "totalVolume" | "maxReps" | "maxCalories" | "maxDistance" | "maxDuration";

export const METRIC_ORDER: readonly Metric[] = ["est1rm", "topSet", "volume", "reps", "calories", "distance", "duration"];

export const METRICS: Record<Metric, { label: string; field: MetricField; unit: RecordUnit }> = {
  est1rm: { label: "Est. 1RM", field: "bestE1rm", unit: "kg" },
  topSet: { label: "Top set", field: "topSetWeight", unit: "kg" },
  volume: { label: "Volume", field: "totalVolume", unit: "kg_reps" },
  reps: { label: "Reps", field: "maxReps", unit: "reps" },
  calories: { label: "Calories", field: "maxCalories", unit: "cal" },
  distance: { label: "Distance", field: "maxDistance", unit: "m" },
  duration: { label: "Time", field: "maxDuration", unit: "s" },
};

/** Whole-number y-axis ticks (`LineChart integer`): counts and seconds; a distance can be fractional. */
export const INTEGER_METRICS: ReadonlySet<Metric> = new Set<Metric>(["reps", "calories", "duration"]);

/** Spec 18.1 AC32: only weights convert to lb — never reps, calories, meters or seconds. */
const convertsToLb = (unit: RecordUnit): boolean => unit === "kg" || unit === "kg_reps";

/** `canonical` is the served number; `y` is what is scaled (lb when the lifter reads lb). */
export interface ChartPoint {
  id: string;
  localDate: string;
  canonical: number;
  y: number;
}

const valueOf = (point: ProgressPoint, metric: Metric): number | null => point[METRICS[metric].field];

/** One metric's points, oldest → newest; a `null` is skipped, never plotted as 0 (D3). */
export function pointsFor(series: ProgressSeries | undefined, metric: Metric | undefined, pref: UnitPreference): ChartPoint[] {
  if (!series || !metric) return [];
  const convert = convertsToLb(METRICS[metric].unit) && pref === "lb";
  return series.points.flatMap((point) => {
    const canonical = valueOf(point, metric);
    if (canonical === null) return [];
    return [{ id: point.workoutId, localDate: point.localDate, canonical, y: convert ? kgToLb(canonical) : canonical }];
  });
}

export function availableMetrics(series?: ProgressSeries): Metric[] {
  if (!series) return [];
  return METRIC_ORDER.filter((m) => series.points.some((p) => valueOf(p, m) !== null));
}

/** Est. 1RM, else top set, else reps, then the 18.1 metrics — never volume (a session sum, not the set PR; 07.2 D12). */
export function defaultMetric(available: readonly Metric[]): Metric | undefined {
  return (["est1rm", "topSet", "reps", "calories", "distance", "duration"] as const).find((m) => available.includes(m));
}

export function resolveMetric(chosen: Metric | null | undefined, available: readonly Metric[]): Metric | undefined {
  return chosen && available.includes(chosen) ? chosen : defaultMetric(available);
}

/** The displayed string always comes from the canonical value through the shared formatter (08.0 D8). */
export function formatPointValue(point: ChartPoint, metric: Metric, pref: UnitPreference): string {
  // Spec 17.2 AC29: an estimate is shown on a coarse step here too; the plotted data stays exact.
  if (metric === "est1rm") return roundedE1rm(point.canonical, pref);
  return formatRecordValue(point.canonical, METRICS[metric].unit, pref);
}

export function captionFor(metric: Metric, pref: UnitPreference): string {
  const { label, unit } = METRICS[metric];
  switch (unit) {
    case "reps":
      return label;
    case "kg_reps":
      return `${label} (${pref} × reps)`;
    case "kg":
      return `${label} (${pref})`;
    // Spec 18.1 §6.10: the axis plots the canonical number, so the caption names its unit.
    case "cal":
      return "Calories";
    case "m":
      return "Distance (m)";
    case "s":
      return "Time (seconds)";
  }
}

export function chartSummary({
  metric,
  range,
  points,
  pref,
}: {
  metric: Metric;
  range: Range;
  points: readonly ChartPoint[];
  pref: UnitPreference;
}): string {
  const head = `${METRICS[metric].label}, ${rangeLabel(range)}:`;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return `${head} no sessions`;
  if (points.length === 1) return `${head} 1 session, ${formatPointValue(first, metric, pref)}`;
  const best = points.reduce((a, b) => (b.canonical > a.canonical ? b : a));
  return `${head} ${formatPointValue(first, metric, pref)} to ${formatPointValue(last, metric, pref)}, best ${formatPointValue(best, metric, pref)}`;
}
