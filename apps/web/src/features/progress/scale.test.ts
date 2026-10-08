import { describe, expect, it } from "vitest";
import type { ChartPoint } from "./metrics";
import { VIEW, hitAreas, layoutChart, niceTicks, xLabels } from "./scale";

const pt = (id: string, localDate: string, y: number): ChartPoint => ({ id, localDate, canonical: y, y });

const checkTicks = (ticks: number[], min: number, max: number, count: number) => {
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  expect(ticks.length).toBeLessThanOrEqual(count + 1);
  expect(ticks[0]).toBeLessThanOrEqual(min);
  expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]!);
  for (const t of ticks) {
    expect(Number.isFinite(t)).toBe(true);
    expect(String(t)).not.toMatch(/\.\d*(0000|9999)/); // no float artefacts in the fraction
  }
};

describe("08.1 AC3 — niceTicks", () => {
  it.each([
    ["flat", 100, 100],
    ["single small", 1, 1],
    ["zero", 0, 0],
    ["wide (lb volume)", 0.5, 480_000],
    ["narrow", 101.2, 101.8],
    ["lb series", 231.5, 270.1],
    ["artefact-prone", 0.1, 0.3],
  ])("%s: covers [min, max] on a 1-2-5 step, ≤ count + 1 ticks", (_l, min, max) => {
    checkTicks(niceTicks(min, max, 4), min, max, 4);
  });

  it("known values", () => {
    expect(niceTicks(100, 100, 4)).toEqual([90, 95, 100, 105, 110]);
    expect(niceTicks(231.5, 270.1, 4)).toEqual([220, 240, 260, 280]);
    expect(niceTicks(0.5, 480_000, 4)).toEqual([0, 200_000, 400_000, 600_000]);
    expect(niceTicks(0.1, 0.3, 2)).toEqual([0.1, 0.2, 0.3]);
  });

  it("integer mode (reps): step ≥ 1, integers only", () => {
    expect(niceTicks(8, 12, 4, { integer: true })).toEqual([8, 9, 10, 11, 12]);
    for (const t of niceTicks(1, 1, 4, { integer: true })) expect(Number.isInteger(t)).toBe(true);
  });
});

describe("08.1 AC4 — chart geometry", () => {
  it("y is inverted: a larger value sits higher (smaller y)", () => {
    const layout = layoutChart([pt("a", "2026-09-01", 100), pt("b", "2026-09-02", 120)]);
    const [a, b] = layout.points;
    expect(b!.py).toBeLessThan(a!.py);
    expect(layout.ticks[0]!.y).toBeGreaterThan(layout.ticks.at(-1)!.y);
  });

  it("x is real time: a 3-week gap is wider than a 1-day step", () => {
    const layout = layoutChart([pt("a", "2026-09-01", 1), pt("b", "2026-09-02", 1), pt("c", "2026-09-23", 1)]);
    const [a, b, c] = layout.points;
    expect(c!.x - b!.x).toBeGreaterThan((b!.x - a!.x) * 10);
    expect(a!.x).toBe(VIEW.left);
    expect(c!.x).toBe(VIEW.width - VIEW.right);
  });

  it("one point, or all on one date, is centred", () => {
    const centre = VIEW.left + (VIEW.width - VIEW.left - VIEW.right) / 2;
    expect(layoutChart([pt("a", "2026-09-01", 5)]).points[0]!.x).toBe(centre);
    const same = layoutChart([pt("a", "2026-09-01", 5), pt("b", "2026-09-01", 6)]);
    expect(same.points.map((p) => p.x)).toEqual([centre, centre]);
  });

  describe("hitAreas: one rect per point, tiling the viewBox (final review I2)", () => {
    type Rect = { id: string; x: number; y: number; width: number; height: number };
    const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    const strictlyInside = (r: Rect, x: number, y: number) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height;
    const overlap = (a: Rect, b: Rect) =>
      Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

    it("one point owns the whole viewBox", () => {
      expect(hitAreas(layoutChart([pt("a", "2026-09-01", 1)]))).toEqual([{ id: "a", x: 0, y: 0, width: VIEW.width, height: VIEW.height }]);
    });

    it("weekly sessions a year long with near-equal values: each dot lies in its own area only; areas tile the viewBox", () => {
      const start = Date.UTC(2025, 9, 9);
      const weekly = Array.from({ length: 52 }, (_, i) =>
        pt(`w${i}`, new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10), 100 + (i % 2) * 0.5),
      );
      const layout = layoutChart(weekly);
      const areas = hitAreas(layout);
      expect(areas.map((a) => a.id)).toEqual(weekly.map((p) => p.id));
      layout.points.forEach((p, i) => {
        expect(inside(areas[i]!, p.x, p.py)).toBe(true);
        areas.forEach((a, j) => {
          if (j !== i) expect(strictlyInside(a, p.x, p.py)).toBe(false);
        });
      });
      for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) expect(overlap(areas[i]!, areas[j]!)).toBe(false);
      expect(areas.reduce((s, a) => s + a.width * a.height, 0)).toBeCloseTo(VIEW.width * VIEW.height, 6);
    });

    it("the boundary between neighbours is their x midpoint", () => {
      const layout = layoutChart([pt("a", "2026-09-01", 1), pt("b", "2026-09-11", 2), pt("c", "2026-10-01", 3)]);
      const [a, b, c] = hitAreas(layout);
      const [pa, pb, pc] = layout.points;
      expect(a!.x).toBe(0);
      expect(a!.x + a!.width).toBeCloseTo((pa!.x + pb!.x) / 2, 9);
      expect(b!.x).toBeCloseTo((pa!.x + pb!.x) / 2, 9);
      expect(b!.x + b!.width).toBeCloseTo((pb!.x + pc!.x) / 2, 9);
      expect(c!.x + c!.width).toBe(VIEW.width);
      for (const r of [a!, b!, c!]) expect([r.y, r.height]).toEqual([0, VIEW.height]);
    });

    it("same-date sessions split their column at the y midpoint, higher value on top; other points keep full-width areas", () => {
      const layout = layoutChart([pt("a", "2026-07-01", 100), pt("b", "2026-09-01", 100), pt("c", "2026-09-01", 120)]);
      const [a, b, c] = hitAreas(layout);
      const [, pb, pc] = layout.points;
      const mid = (pb!.py + pc!.py) / 2;
      expect(c!.y).toBe(0);
      expect(c!.y + c!.height).toBeCloseTo(mid, 9);
      expect(b!.y).toBeCloseTo(mid, 9);
      expect(b!.y + b!.height).toBe(VIEW.height);
      expect([b!.x, b!.width]).toEqual([c!.x, c!.width]);
      // a's area is not shrunk by the same-date pair: ≥ 56 units (44 CSS px at a 288 px chart) wide.
      expect(a!.width).toBeGreaterThanOrEqual(56);
    });
  });

  it("xLabels: month starts inside the span, thinned to ≤ 4", () => {
    const layout = layoutChart([pt("a", "2026-07-08", 1), pt("b", "2026-10-06", 1)]);
    expect(xLabels(layout).map((l) => l.text)).toEqual(["Aug", "Sep", "Oct"]);
    const labels = xLabels(layoutChart([pt("a", "2026-01-15", 1), pt("b", "2026-12-20", 1)]));
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it("xLabels: fallback to first/last day-month, single date, and year only across a year boundary", () => {
    expect(xLabels(layoutChart([pt("a", "2026-10-06", 1), pt("b", "2026-10-21", 1)])).map((l) => l.text)).toEqual(["6 Oct", "21 Oct"]);
    expect(xLabels(layoutChart([pt("a", "2026-10-06", 1)])).map((l) => l.text)).toEqual(["6 Oct"]);
    expect(xLabels(layoutChart([pt("a", "2025-11-10", 1), pt("b", "2026-02-10", 1)])).map((l) => l.text)).toEqual([
      "Dec 25",
      "Jan 26",
      "Feb 26",
    ]);
  });
});
