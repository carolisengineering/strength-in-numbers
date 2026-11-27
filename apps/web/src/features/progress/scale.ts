import { monthDayText, monthText } from "../../ui/dateText";
import type { ChartPoint } from "./metrics";

/** The chart's coordinate system (Spec 08.1 §6.3): one unit is one CSS px since Spec 17.12 AC23. */
export interface View {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const MARGINS = { left: 48, right: 16, top: 12, bottom: 28 } as const;

const MIN_HEIGHT = 220;
const MAX_HEIGHT = 320;

/** The view for a measured width: as wide as the box, half as tall, between 220 and 320 (Spec 17.12 AC23). */
export function viewFor(width: number): View {
  return { width, height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width / 2))), ...MARGINS };
}

/** Today's 360 × 220 view: the chart where nothing measures it (jsdom; `ui/useMeasuredWidth`'s fallback). */
export const DEFAULT_VIEW: View = viewFor(360);

const plotWidth = (view: View) => view.width - view.left - view.right;
const plotHeight = (view: View) => view.height - view.top - view.bottom;

const decimalsOf = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

function nextNice(step: number): number {
  const mag = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const m = Math.round(step / mag);
  return (m === 1 ? 2 : m === 2 ? 5 : 10) * mag;
}

/** Ascending ticks on a 1-2-5 × 10ⁿ step covering [min, max], at most `count + 1` (AC3). */
export function niceTicks(min: number, max: number, count: number, { integer = false }: { integer?: boolean } = {}): number[] {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    // All zero pads upward only: no metric here is negative (code review #5).
    if (lo === 0) {
      hi = 1;
    } else {
      const padBy = Math.abs(lo) * 0.1;
      lo -= padBy;
      hi += padBy;
    }
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, step);
  for (;;) {
    const first = Math.floor(lo / step + 1e-9);
    const last = Math.ceil(hi / step - 1e-9);
    if (last - first <= count) {
      const dp = decimalsOf(step);
      return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toFixed(dp)));
    }
    step = nextNice(step);
  }
}

export interface PlottedPoint extends ChartPoint {
  x: number;
  py: number;
}

export interface ChartLayout {
  ticks: { value: number; y: number }[];
  points: PlottedPoint[];
  view: View;
}

/** Days since 1970-01-01, from the date string in UTC — no local-zone input. */
const dayNumber = (localDate: string) => {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function layoutChart(
  points: readonly ChartPoint[],
  { integer = false, view = DEFAULT_VIEW }: { integer?: boolean; view?: View } = {},
): ChartLayout {
  if (points.length === 0) return { ticks: [], points: [], view };
  const ys = points.map((p) => p.y);
  const values = niceTicks(Math.min(...ys), Math.max(...ys), 4, { integer });
  const t0 = values[0]!;
  const tN = values.at(-1)!;
  const plotW = plotWidth(view);
  const plotH = plotHeight(view);
  const yOf = (v: number) => view.top + plotH * (1 - (v - t0) / (tN - t0));
  const day0 = dayNumber(points[0]!.localDate);
  const span = dayNumber(points.at(-1)!.localDate) - day0;
  const xOf = (localDate: string) =>
    span === 0 ? view.left + plotW / 2 : view.left + (plotW * (dayNumber(localDate) - day0)) / span;
  return {
    ticks: values.map((value) => ({ value, y: yOf(value) })),
    points: points.map((p) => ({ ...p, x: xOf(p.localDate), py: yOf(p.y) })),
    view,
  };
}

export interface HitArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One tap rect per point, in point order, tiling the whole viewBox (§6.3, final review I2): each x
 * column runs between the midpoints to its neighbouring columns (outer columns reach the edges), and
 * same-date points split their column at the y midpoints, higher value on top. Areas never overlap,
 * so a tap always selects the point whose area it lands in, and a dense stretch never shrinks a
 * sparse point's area.
 */
export function hitAreas(layout: ChartLayout): HitArea[] {
  const { view } = layout;
  const columns: PlottedPoint[][] = [];
  for (const p of layout.points) {
    const last = columns.at(-1);
    if (last && last[0]!.x === p.x) last.push(p);
    else columns.push([p]);
  }
  const byId = new Map<string, HitArea>();
  columns.forEach((column, i) => {
    const x = column[0]!.x;
    const left = i === 0 ? 0 : (columns[i - 1]![0]!.x + x) / 2;
    const right = i === columns.length - 1 ? view.width : (x + columns[i + 1]![0]!.x) / 2;
    // Equal values on one date share a y slice, split side by side, so none is left with zero area (code review #6).
    const rows: PlottedPoint[][] = [];
    for (const p of [...column].sort((a, b) => a.py - b.py)) {
      const row = rows.at(-1);
      if (row && row[0]!.py === p.py) row.push(p);
      else rows.push([p]);
    }
    rows.forEach((row, j) => {
      const py = row[0]!.py;
      const top = j === 0 ? 0 : (rows[j - 1]![0]!.py + py) / 2;
      const bottom = j === rows.length - 1 ? view.height : (py + rows[j + 1]![0]!.py) / 2;
      const width = (right - left) / row.length;
      row.forEach((p, k) => byId.set(p.id, { id: p.id, x: left + k * width, y: top, width, height: bottom - top }));
    });
  });
  return layout.points.map((p) => byId.get(p.id)!);
}

export type LabelAnchor = "start" | "middle" | "end";

// A generous width per character at the labels' 14-unit font, so a label estimated to fit really does.
const LABEL_CHAR_WIDTH = 8;

/** A month label stays centered on its tick unless that would cross the viewBox's edge (Spec 17.13: years make it longer). */
function monthAnchor(x: number, text: string, view: View): LabelAnchor {
  const half = (text.length * LABEL_CHAR_WIDTH) / 2;
  if (x + half > view.width) return "end";
  if (x - half < 0) return "start";
  return "middle";
}

/** A label's estimated left and right edges, placed by its anchor. */
function labelBox({ x, text, anchor }: { x: number; text: string; anchor: LabelAnchor }): { left: number; right: number } {
  const width = text.length * LABEL_CHAR_WIDTH;
  const left = anchor === "start" ? x : anchor === "middle" ? x - width / 2 : x - width;
  return { left, right: left + width };
}

/**
 * Minor 533: an end-anchored label moves toward the one before it, and a long-month-name locale ("déc. 2025",
 * "janv. 2026") can make them meet. Walking from the right, the newest label stays and an earlier one is dropped only
 * when the label kept after it is end-anchored and their estimated boxes meet. Centered labels keep today's thinning:
 * the estimate is generous (`LABEL_CHAR_WIDTH`), so checking them too would drop en-US labels that fit (final review).
 * Minor 698, the start-edge mirror: a start-anchored label moves toward the one after it, so it is dropped when their
 * boxes meet. The earlier label goes, so the newest stays.
 */
function dropMeeting<T extends { x: number; text: string; anchor: LabelAnchor }>(labels: T[]): T[] {
  const kept: T[] = [];
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = labels[i]!;
    const next = kept[0];
    const checked = next !== undefined && (next.anchor === "end" || label.anchor === "start");
    if (!checked || labelBox(label).right <= labelBox(next).left) kept.unshift(label);
  }
  return kept;
}

/**
 * 3–4 month-start labels inside the span, else first/last day-month; a year only across a year boundary (D9), and
 * the full year (Spec 17.13): under en-US a two-digit one reads as a day ("Dec 25").
 */
export function xLabels(layout: ChartLayout): { x: number; text: string; anchor: LabelAnchor }[] {
  const pts = layout.points;
  const first = pts[0];
  const last = pts.at(-1);
  if (!first || !last) return [];
  const [fy, fm] = first.localDate.split("-").map(Number) as [number, number];
  const [ly, lm] = last.localDate.split("-").map(Number) as [number, number];
  const withYear = fy !== ly;
  const { view } = layout;
  const span = dayNumber(last.localDate) - dayNumber(first.localDate);
  const xOf = (localDate: string) =>
    span === 0 ? first.x : view.left + (plotWidth(view) * (dayNumber(localDate) - dayNumber(first.localDate))) / span;

  const starts: { localDate: string; y: number; m: number }[] = [];
  let y = fy;
  let m = fm;
  while (y < ly || (y === ly && m <= lm)) {
    const localDate = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    if (localDate >= first.localDate && localDate <= last.localDate) starts.push({ localDate, y, m });
    if (m === 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
  }
  if (starts.length >= 2) {
    const every = Math.ceil(starts.length / 4);
    return dropMeeting(
      starts
        .filter((_, i) => i % every === 0)
        .map((s) => {
          const x = xOf(s.localDate);
          const text = monthText(s.y, s.m, { withYear });
          return { x, text, anchor: monthAnchor(x, text, view) };
        }),
    );
  }
  const dayMonth = (p: PlottedPoint) => monthDayText(p.localDate, { withYear });
  // The two ends sit on the plot's edges, so their labels anchor inward: "Jan 10, 2026" centered on the right edge
  // would run off a phone's screen.
  return span === 0
    ? [{ x: first.x, text: dayMonth(first), anchor: "middle" }]
    : [
        { x: first.x, text: dayMonth(first), anchor: "start" },
        { x: last.x, text: dayMonth(last), anchor: "end" },
      ];
}
