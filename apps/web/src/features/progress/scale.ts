import type { ChartPoint } from "./metrics";

/** The chart's fixed coordinate system (Spec 08.1 §6.3); the browser scales it to the container's width. */
export const VIEW = { width: 360, height: 220, left: 48, right: 16, top: 12, bottom: 28 } as const;
const PLOT_W = VIEW.width - VIEW.left - VIEW.right; // 296
const PLOT_H = VIEW.height - VIEW.top - VIEW.bottom; // 180

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

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
    const padBy = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= padBy;
    hi += padBy;
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
}

/** Days since 1970-01-01, from the date string in UTC — no local-zone input. */
const dayNumber = (localDate: string) => {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function layoutChart(points: readonly ChartPoint[], { integer = false }: { integer?: boolean } = {}): ChartLayout {
  if (points.length === 0) return { ticks: [], points: [] };
  const ys = points.map((p) => p.y);
  const values = niceTicks(Math.min(...ys), Math.max(...ys), 4, { integer });
  const t0 = values[0]!;
  const tN = values.at(-1)!;
  const yOf = (v: number) => VIEW.top + PLOT_H * (1 - (v - t0) / (tN - t0));
  const day0 = dayNumber(points[0]!.localDate);
  const span = dayNumber(points.at(-1)!.localDate) - day0;
  const xOf = (localDate: string) =>
    span === 0 ? VIEW.left + PLOT_W / 2 : VIEW.left + (PLOT_W * (dayNumber(localDate) - day0)) / span;
  return {
    ticks: values.map((value) => ({ value, y: yOf(value) })),
    points: points.map((p) => ({ ...p, x: xOf(p.localDate), py: yOf(p.y) })),
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
    const right = i === columns.length - 1 ? VIEW.width : (x + columns[i + 1]![0]!.x) / 2;
    const byY = [...column].sort((a, b) => a.py - b.py);
    byY.forEach((p, j) => {
      const top = j === 0 ? 0 : (byY[j - 1]!.py + p.py) / 2;
      const bottom = j === byY.length - 1 ? VIEW.height : (p.py + byY[j + 1]!.py) / 2;
      byId.set(p.id, { id: p.id, x: left, y: top, width: right - left, height: bottom - top });
    });
  });
  return layout.points.map((p) => byId.get(p.id)!);
}

/** 3–4 month-start labels inside the span, else first/last day-month; a two-digit year only across a year boundary (D9). */
export function xLabels(layout: ChartLayout): { x: number; text: string }[] {
  const pts = layout.points;
  const first = pts[0];
  const last = pts.at(-1);
  if (!first || !last) return [];
  const [fy, fm] = first.localDate.split("-").map(Number) as [number, number];
  const [ly, lm] = last.localDate.split("-").map(Number) as [number, number];
  const crossesYear = fy !== ly;
  const suffix = (y: number) => (crossesYear ? ` ${String(y % 100).padStart(2, "0")}` : "");
  const span = dayNumber(last.localDate) - dayNumber(first.localDate);
  const xOf = (localDate: string) =>
    span === 0 ? first.x : VIEW.left + (PLOT_W * (dayNumber(localDate) - dayNumber(first.localDate))) / span;

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
    return starts
      .filter((_, i) => i % every === 0)
      .map((s) => ({ x: xOf(s.localDate), text: `${MONTHS[s.m - 1]}${suffix(s.y)}` }));
  }
  const dayMonth = (p: PlottedPoint) => {
    const [py, pm, pd] = p.localDate.split("-").map(Number) as [number, number, number];
    return `${pd} ${MONTHS[pm - 1]}${suffix(py)}`;
  };
  return span === 0
    ? [{ x: first.x, text: dayMonth(first) }]
    : [
        { x: first.x, text: dayMonth(first) },
        { x: last.x, text: dayMonth(last) },
      ];
}
