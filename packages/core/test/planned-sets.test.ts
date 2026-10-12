import { describe, expect, it } from "vitest";
import {
  deriveTargets,
  expandQuickLine,
  isUniformWorking,
  normalizePlannedSet,
  plannedSetViolations,
  type PlannedSet,
} from "../src/index.js";

const row = (o: Partial<PlannedSet> = {}): PlannedSet => ({
  setType: "working", repsLow: 8, repsHigh: 8, weight: 100, weightUnit: "kg", ...o,
});

describe("AC6 — expandQuickLine", () => {
  it.each([
    [{ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 8 }, 3, { repsLow: 6, repsHigh: 8 }],
    [{ targetSets: 2, targetRepsLow: null, targetRepsHigh: null }, 2, { repsLow: null, repsHigh: null }],
    [{ targetSets: 2 }, 2, { repsLow: null, repsHigh: null }],
  ])("%j → %i identical working rows, no weight", (t, n, reps) => {
    const rows = expandQuickLine(t);
    expect(rows).toHaveLength(n);
    for (const r of rows) expect(r).toEqual({ setType: "working", ...reps, weight: null, weightUnit: null });
  });

  it.each([[{}], [{ targetSets: null }], [{ targetSets: null, targetRepsLow: 8, targetRepsHigh: 10 }]])(
    "%j → no rows (O1: a rep range with no set count stays rowless)",
    (t) => {
      expect(expandQuickLine(t)).toEqual([]);
    },
  );

  it("rows are independent objects", () => {
    const [a, b] = expandQuickLine({ targetSets: 2 });
    expect(a).not.toBe(b);
  });
});

describe("AC8 — deriveTargets", () => {
  it("no rows → all null", () => {
    expect(deriveTargets([])).toEqual({ targetSets: null, targetRepsLow: null, targetRepsHigh: null });
  });
  it("a ramp 10 / 8 / 6 → 3 sets, 6–10", () => {
    const rows = [row({ repsLow: 10, repsHigh: 10 }), row({ repsLow: 8, repsHigh: 8 }), row({ repsLow: 6, repsHigh: 6 })];
    expect(deriveTargets(rows)).toEqual({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10 });
  });
  it("ranges: min of lows, max of highs; rows without reps are ignored for reps but counted", () => {
    const rows = [row({ repsLow: 6, repsHigh: 8 }), row({ repsLow: null, repsHigh: null }), row({ repsLow: 10, repsHigh: 12 })];
    expect(deriveTargets(rows)).toEqual({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 12 });
  });
  it("rows but none with reps → count only", () => {
    expect(deriveTargets([row({ repsLow: null, repsHigh: null })])).toEqual({ targetSets: 1, targetRepsLow: null, targetRepsHigh: null });
  });
});

describe("AC5 (core) — plannedSetViolations by modality", () => {
  const full = { setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 20, weightUnit: "kg" as const };
  it("weight_reps and weighted_bodyweight accept reps + weight", () => {
    expect(plannedSetViolations("weight_reps", [full])).toEqual([]);
    expect(plannedSetViolations("weighted_bodyweight", [full])).toEqual([]);
  });
  it("bodyweight_reps rejects weight and weightUnit, accepts reps", () => {
    expect(plannedSetViolations("bodyweight_reps", [full]).map((v) => v.field)).toEqual(["weight", "weightUnit"]);
    expect(plannedSetViolations("bodyweight_reps", [{ repsLow: 5, repsHigh: 5 }])).toEqual([]);
  });
  it.each(["duration", "distance_duration"] as const)("%s rejects reps and weight; a type-only row is fine", (m) => {
    expect(plannedSetViolations(m, [full]).map((v) => v.field)).toEqual(["repsLow", "repsHigh", "weight", "weightUnit"]);
    expect(plannedSetViolations(m, [{ setType: "warmup" }])).toEqual([]);
  });
  it("reports the row index", () => {
    expect(plannedSetViolations("bodyweight_reps", [{}, { weight: 5, weightUnit: "kg" }])[0]!.row).toBe(1);
  });
});

describe("AC23 — isUniformWorking", () => {
  it.each([
    [[row(), row(), row()], true],
    [[row()], true],
    [[], false],
    [[row(), row({ repsLow: 6, repsHigh: 6 })], false],
    [[row(), row({ weightUnit: "lb" })], false],
    [[row(), row({ weight: 102.5 })], false],
    [[row({ setType: "warmup" }), row()], false],
  ])("%j → %s", (rows, expected) => {
    expect(isUniformWorking(rows)).toBe(expected);
  });
});

describe("normalizePlannedSet", () => {
  it("defaults setType to working and absent fields to null", () => {
    expect(normalizePlannedSet({})).toEqual({ setType: "working", repsLow: null, repsHigh: null, weight: null, weightUnit: null });
  });
});
