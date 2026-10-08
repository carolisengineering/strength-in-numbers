import { describe, expect, it } from "vitest";
import type { ProgressSeries } from "@sin/core";
import { makeProgressPoint } from "../../test/workoutFixtures";
import {
  METRIC_ORDER,
  availableMetrics,
  captionFor,
  chartSummary,
  defaultMetric,
  formatPointValue,
  pointsFor,
  resolveMetric,
} from "./metrics";

const series = (points: ReturnType<typeof makeProgressPoint>[]): ProgressSeries =>
  ({ exerciseId: "10000000-0000-4000-8000-0000000000e1", points }) as ProgressSeries;

describe("08.1 AC2 — metrics are data-derived and null-safe", () => {
  const a = makeProgressPoint({ localDate: "2026-09-01", bestE1rm: 105, topSetWeight: 90 });
  const b = makeProgressPoint({ localDate: "2026-09-08", bestE1rm: null, topSetWeight: 95 });
  const c = makeProgressPoint({ localDate: "2026-09-15", bestE1rm: 122.5, topSetWeight: 100 });

  it("skips null values (never plots zero) and keeps API order", () => {
    const pts = pointsFor(series([a, b, c]), "est1rm", "kg");
    expect(pts.map((p) => p.id)).toEqual([a.workoutId, c.workoutId]);
    expect(pts.map((p) => p.canonical)).toEqual([105, 122.5]);
    expect(pts.map((p) => p.y)).toEqual([105, 122.5]);
  });

  it("converts weight to lb before scaling, keeping the canonical value", () => {
    const [p] = pointsFor(series([c]), "est1rm", "lb");
    expect(p!.canonical).toBe(122.5);
    expect(p!.y).toBeCloseTo(270.066, 3); // 122.5 / 0.45359237
  });

  it("never converts reps", () => {
    const r = makeProgressPoint({ bestE1rm: null, topSetWeight: null, totalVolume: null, maxReps: 12 });
    expect(pointsFor(series([r]), "reps", "lb")[0]!.y).toBe(12);
  });

  it("available metrics are those with ≥ 1 non-null point, in display order", () => {
    expect(METRIC_ORDER).toEqual(["est1rm", "topSet", "volume", "reps"]);
    expect(availableMetrics(series([a, b, c]))).toEqual(["est1rm", "topSet", "volume"]);
    expect(availableMetrics(series([]))).toEqual([]);
    expect(availableMetrics(undefined)).toEqual([]);
  });

  it("default: est. 1RM, else top set, else reps; never volume; undefined when empty", () => {
    expect(defaultMetric(["est1rm", "topSet", "volume"])).toBe("est1rm");
    expect(defaultMetric(["topSet", "volume"])).toBe("topSet");
    expect(defaultMetric(["volume", "reps"])).toBe("reps");
    expect(defaultMetric(["volume"])).toBeUndefined();
    expect(defaultMetric([])).toBeUndefined();
  });

  it("resolveMetric keeps an available choice, else falls back to the default", () => {
    expect(resolveMetric("volume", ["est1rm", "volume"])).toBe("volume");
    expect(resolveMetric("reps", ["est1rm", "volume"])).toBe("est1rm");
    expect(resolveMetric(null, ["topSet"])).toBe("topSet");
    expect(resolveMetric(undefined, [])).toBeUndefined();
  });

  it("values and captions use the shared formatter", () => {
    const [p] = pointsFor(series([c]), "est1rm", "lb");
    expect(formatPointValue(p!, "est1rm", "lb")).toBe("270.1 lb");
    expect(captionFor("est1rm", "kg")).toBe("Est. 1RM (kg)");
    expect(captionFor("volume", "lb")).toBe("Volume (lb × reps)");
    expect(captionFor("reps", "lb")).toBe("Reps");
  });
});

describe("08.1 AC9 — the chart's accessible summary", () => {
  const p1 = makeProgressPoint({ localDate: "2026-08-01", bestE1rm: 105 });
  const p2 = makeProgressPoint({ localDate: "2026-09-01", bestE1rm: 125 });
  const p3 = makeProgressPoint({ localDate: "2026-10-01", bestE1rm: 122.5 });

  it("first to last, best, in kg", () => {
    const points = pointsFor(series([p1, p2, p3]), "est1rm", "kg");
    expect(chartSummary({ metric: "est1rm", range: "3m", points, pref: "kg" })).toBe(
      "Est. 1RM, 3 months: 105 kg to 122.5 kg, best 125 kg",
    );
  });

  it("in lb, through the same formatter as the readout", () => {
    const points = pointsFor(series([p1, p3]), "est1rm", "lb");
    expect(chartSummary({ metric: "est1rm", range: "1y", points, pref: "lb" })).toBe(
      "Est. 1RM, 1 year: 231.5 lb to 270.1 lb, best 270.1 lb",
    );
    expect(formatPointValue(points[1]!, "est1rm", "lb")).toBe("270.1 lb");
  });

  it("one point", () => {
    const points = pointsFor(series([p3]), "est1rm", "kg");
    expect(chartSummary({ metric: "est1rm", range: "all", points, pref: "kg" })).toBe(
      "Est. 1RM, all time: 1 session, 122.5 kg",
    );
  });
});
