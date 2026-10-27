import { kgToLb, type ProgressSeries } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { formatRecordByType } from "../units/format";
import { availableMetrics, captionFor, defaultMetric, formatPointValue, INTEGER_METRICS, METRICS, pointsFor, type Metric } from "./metrics";

const NONE = { bestE1rm: null, topSetWeight: null, totalVolume: null, maxReps: null };
const series = (points: Record<string, unknown>[]): ProgressSeries => ({
  exerciseId: "10000000-0000-4000-8000-0000000000d1" as ProgressSeries["exerciseId"],
  points: points.map((p, i) => makeProgressPoint({ ...NONE, localDate: `2026-10-0${i + 1}`, ...p })),
});
const calories = series([{ maxCalories: 110 }, { maxCalories: 120 }]);
const carry = series([{ topSetWeight: 24, maxDistance: 40 }, { topSetWeight: 32, maxDistance: 12.192 }]);
const hold = series([{ topSetWeight: 20, maxDuration: 90 }, { topSetWeight: 20, maxDuration: 75 }]);

describe("18.1 AC31 — metrics", () => {
  it("each type offers only the metrics it has", () => {
    expect(availableMetrics(calories)).toEqual(["calories"]);
    expect(availableMetrics(carry)).toEqual(["topSet", "distance"]);
    expect(availableMetrics(hold)).toEqual(["topSet", "duration"]);
  });
  it("the default prefers est1rm, topSet, reps, calories, distance, duration", () => {
    expect(defaultMetric(["calories"])).toBe("calories");
    expect(defaultMetric(["topSet", "distance"])).toBe("topSet");
    expect(defaultMetric(["distance"])).toBe("distance");
    expect(defaultMetric(["duration"])).toBe("duration");
  });
  it("chip labels", () => {
    expect([METRICS.calories.label, METRICS.distance.label, METRICS.duration.label]).toEqual(["Calories", "Distance", "Time"]);
  });
  it("reps, calories and time get integer ticks; distance does not", () => {
    expect([...INTEGER_METRICS].sort()).toEqual(["calories", "duration", "reps"]);
  });
});

describe("18.1 AC32 — units on the chart", () => {
  it("Review Focus 3 — a lb account converts Top set but not Distance or Time", () => {
    expect(pointsFor(carry, "distance", "lb")[0]!.y).toBe(40);
    expect(pointsFor(hold, "duration", "lb")[0]!.y).toBe(90);
    expect(pointsFor(calories, "calories", "lb")[0]!.y).toBe(110);
    expect(pointsFor(carry, "topSet", "lb")[0]!.y).toBe(kgToLb(24));
  });
  it("captions for the new metrics; the old ones unchanged", () => {
    expect(captionFor("calories", "lb")).toBe("Calories");
    expect(captionFor("distance", "lb")).toBe("Distance (m)");
    expect(captionFor("duration", "kg")).toBe("Time (seconds)");
    expect(captionFor("est1rm", "lb")).toBe("Est. 1RM (lb)");
    expect(captionFor("volume", "kg")).toBe("Volume (kg × reps)");
    expect(captionFor("reps", "kg")).toBe("Reps");
  });
  it("the readout says a time in words and a distance in meters", () => {
    expect(formatPointValue(pointsFor(hold, "duration", "kg")[0]!, "duration", "kg")).toBe("1 min 30 s");
    expect(formatPointValue(pointsFor(carry, "distance", "lb")[1]!, "distance", "lb")).toBe("12.192 m");
  });
});

describe("18.1 AC33 — the best point and its record read the same (formatting only; the server keeps the values equal)", () => {
  const cases: [string, ProgressSeries, Metric, string, string][] = [
    ["calories", calories, "calories", "max_calories", "cal"],
    ["carry distance", carry, "distance", "max_distance", "m"],
    ["carry top set", carry, "topSet", "heaviest_weight", "kg"],
    ["hold time", hold, "duration", "max_duration", "s"],
    ["hold top set", hold, "topSet", "heaviest_weight", "kg"],
  ];
  it.each(cases)("%s: the best point reads like the record, in kg and lb", (_l, s, metric, recordType, unit) => {
    for (const pref of ["kg", "lb"] as const) {
      const points = pointsFor(s, metric, pref);
      const best = points.reduce((a, b) => (b.canonical > a.canonical ? b : a));
      const record = makePersonalRecord({ recordType, unit, value: best.canonical, previousValue: null });
      expect(formatPointValue(best, metric, pref)).toBe(formatRecordByType(record.recordType, record.value, record.unit, pref));
    }
  });
});
