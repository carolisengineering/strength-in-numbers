import { kgToLb, type ProgressPoint, type ProgressSeries, type RecordUnit, type UnitPreference } from "@sin/core";
import { formatRecordValue } from "../units/format";
import { rangeLabel, type Range } from "./range";

/** The four chartable metrics (Spec 08.1 AC2), in display order. */
export type Metric = "est1rm" | "topSet" | "volume" | "reps";
type MetricField = "bestE1rm" | "topSetWeight" | "totalVolume" | "maxReps";

export const METRIC_ORDER: readonly Metric[] = ["est1rm", "topSet", "volume", "reps"];

export const METRICS: Record<Metric, { label: string; field: MetricField; unit: RecordUnit }> = {
  est1rm: { label: "Est. 1RM", field: "bestE1rm", unit: "kg" },
  topSet: { label: "Top set", field: "topSetWeight", unit: "kg" },
  volume: { label: "Volume", field: "totalVolume", unit: "kg_reps" },
  reps: { label: "Reps", field: "maxReps", unit: "reps" },
};

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
  const convert = METRICS[metric].unit !== "reps" && pref === "lb";
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

/** Est. 1RM, else top set, else reps — never volume (a session sum, not the set PR; 07.2 D12). */
export function defaultMetric(available: readonly Metric[]): Metric | undefined {
  return (["est1rm", "topSet", "reps"] as const).find((m) => available.includes(m));
}

export function resolveMetric(chosen: Metric | null | undefined, available: readonly Metric[]): Metric | undefined {
  return chosen && available.includes(chosen) ? chosen : defaultMetric(available);
}

/** The displayed string always comes from the canonical value through the shared formatter (08.0 D8). */
export function formatPointValue(point: ChartPoint, metric: Metric, pref: UnitPreference): string {
  return formatRecordValue(point.canonical, METRICS[metric].unit, pref);
}

export function captionFor(metric: Metric, pref: UnitPreference): string {
  const { label, unit } = METRICS[metric];
  if (unit === "reps") return label;
  return unit === "kg_reps" ? `${label} (${pref} × reps)` : `${label} (${pref})`;
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
