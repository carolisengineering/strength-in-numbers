import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeRecords,
  estimate1rm,
  milliToDecimalString,
  parseWeightKgMilli,
  type RecordSet,
} from "../src/records.js";

let n = 0;
const set = (over: Partial<RecordSet> & Pick<RecordSet, "workoutId">): RecordSet => ({
  setId: `s${++n}`,
  modality: "weight_reps",
  weightKgMilli: 100_000,
  reps: 5,
  ...over,
});
const byType = (sets: RecordSet[]) =>
  Object.fromEntries(computeRecords(sets).map((r) => [r.recordType, r]));

describe("AC3 — estimate1rm is Epley, exact, bounded", () => {
  it("returns null outside 1..12 reps and for non-integer reps", () => {
    expect(estimate1rm(100_000, 0)).toBeNull();
    expect(estimate1rm(100_000, 13)).toBeNull();
    expect(estimate1rm(100_000, 2.5)).toBeNull();
  });
  it("boundaries 1 and 12", () => {
    expect(estimate1rm(100_000, 1)).toBe(103_333); // 100 × 31/30 = 103.3333…
    expect(estimate1rm(100_000, 12)).toBe(140_000); // 100 × 42/30
  });
  it("rounds half-up at the 0.001 kg boundary", () => {
    // w × 31 / 30 with w = 15 → 465 / 30 = 15.5 → 16 (half-up)
    expect(estimate1rm(15, 1)).toBe(16);
    // w = 14 → 434 / 30 = 14.4666… → 14
    expect(estimate1rm(14, 1)).toBe(14);
  });
  it("an lb-derived weight (135 lb → weight_kg 61.235)", () => {
    // 61235 × 35 / 30 = 71440.8333… → 71441
    expect(estimate1rm(61_235, 5)).toBe(71_441);
  });
});

describe("AC4 — weights are parsed, never floated", () => {
  it("parses numeric(7,3) text exactly", () => {
    expect(parseWeightKgMilli("61.235")).toBe(61_235);
    expect(parseWeightKgMilli("60")).toBe(60_000);
    expect(parseWeightKgMilli("60.5")).toBe(60_500);
    expect(parseWeightKgMilli("60.000")).toBe(60_000);
    expect(parseWeightKgMilli("0.001")).toBe(1);
    expect(parseWeightKgMilli("9999.999")).toBe(9_999_999);
  });
  it.each(["", "-1", "1.2345", "1e3", " 60", "60.", ".5", "NaN"])("rejects %j", (s) => {
    expect(() => parseWeightKgMilli(s)).toThrow();
  });
  it("milliToDecimalString is the exact inverse", () => {
    for (const m of [0, 1, 5, 999, 1000, 61_235, 9_999_999, 327_666_967_233]) {
      expect(parseWeightKgMilli(milliToDecimalString(m))).toBe(m);
    }
    expect(milliToDecimalString(61_235)).toBe("61.235");
    expect(milliToDecimalString(5)).toBe("0.005");
  });
  it("milliToDecimalString rejects negatives and non-integers", () => {
    expect(() => milliToDecimalString(-1)).toThrow();
    expect(() => milliToDecimalString(1.5)).toThrow();
  });
  it("records.ts has no float conversions", () => {
    const src = readFileSync(new URL("../src/records.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/parseFloat|toFixed|Math\.round/);
  });
});

describe("AC5 — eligibility is per modality, by the set's own snapshot", () => {
  it("weight_reps and weighted_bodyweight give the three load types, not max_reps", () => {
    for (const modality of ["weight_reps", "weighted_bodyweight"]) {
      const r = byType([set({ workoutId: "w1", modality, weightKgMilli: 100_000, reps: 5 })]);
      expect(Object.keys(r).sort()).toEqual(["best_est_1rm", "best_set_volume", "heaviest_weight"]);
      expect(r.heaviest_weight!.valueMilli).toBe(100_000);
      expect(r.best_est_1rm!.valueMilli).toBe(116_667);
      expect(r.best_set_volume!.valueMilli).toBe(500_000);
      expect(r.best_set_volume!.unit).toBe("kg_reps");
    }
  });
  it("bodyweight_reps gives only max_reps (value = reps × 1000)", () => {
    const r = byType([set({ workoutId: "w1", modality: "bodyweight_reps", weightKgMilli: null, reps: 12 })]);
    expect(Object.keys(r)).toEqual(["max_reps"]);
    expect(r.max_reps!.valueMilli).toBe(12_000);
    expect(r.max_reps!.unit).toBe("reps");
  });
  it("duration and distance_duration give nothing", () => {
    expect(computeRecords([set({ workoutId: "w1", modality: "duration", weightKgMilli: null, reps: null })])).toEqual([]);
    expect(computeRecords([set({ workoutId: "w1", modality: "distance_duration", weightKgMilli: null, reps: null })])).toEqual([]);
  });
  it("zero / null measures are ineligible, never an error", () => {
    expect(computeRecords([set({ workoutId: "w1", weightKgMilli: 0, reps: 5 })])).toEqual([]);
    expect(computeRecords([set({ workoutId: "w1", weightKgMilli: null, reps: 5 })])).toEqual([]);
    expect(computeRecords([set({ workoutId: "w1", weightKgMilli: 100_000, reps: null })])).toEqual([]);
    // reps 0 = a failed attempt (05.1 D14): no heaviest, no e1RM, volume 0 → none
    expect(computeRecords([set({ workoutId: "w1", weightKgMilli: 100_000, reps: 0 })])).toEqual([]);
    expect(computeRecords([set({ workoutId: "w1", modality: "bodyweight_reps", weightKgMilli: null, reps: 0 })])).toEqual([]);
  });
  it("13+ reps still count for heaviest and volume, not e1RM", () => {
    const r = byType([set({ workoutId: "w1", weightKgMilli: 50_000, reps: 15 })]);
    expect(r.best_est_1rm).toBeUndefined();
    expect(r.heaviest_weight!.valueMilli).toBe(50_000);
    expect(r.best_set_volume!.valueMilli).toBe(750_000);
  });
  it("a lineage whose modality changed drops old sets that do not qualify", () => {
    const r = byType([
      set({ workoutId: "w1", modality: "bodyweight_reps", weightKgMilli: null, reps: 20 }),
      set({ workoutId: "w2", modality: "weighted_bodyweight", weightKgMilli: 10_000, reps: 8 }),
    ]);
    expect(r.max_reps!.workoutId).toBe("w1");
    expect(r.heaviest_weight!.workoutId).toBe("w2");
  });
});

describe("AC6 — ties keep the earliest", () => {
  it("across workouts", () => {
    const a = set({ workoutId: "w1", weightKgMilli: 100_000, reps: 5 });
    const b = set({ workoutId: "w2", weightKgMilli: 100_000, reps: 5 });
    expect(byType([a, b]).heaviest_weight!.setId).toBe(a.setId);
  });
  it("within one workout (input order = set_number order)", () => {
    const a = set({ workoutId: "w1", weightKgMilli: 100_000, reps: 5 });
    const b = set({ workoutId: "w1", weightKgMilli: 100_000, reps: 5 });
    expect(byType([a, b]).heaviest_weight!.setId).toBe(a.setId);
  });
});

describe("AC7 — previousValue is the best of strictly-earlier workouts", () => {
  it("null on the first workout; same-workout sets never count", () => {
    const r = byType([
      set({ workoutId: "w1", weightKgMilli: 90_000, reps: 5 }),
      set({ workoutId: "w1", weightKgMilli: 100_000, reps: 5 }),
    ]);
    expect(r.heaviest_weight!.valueMilli).toBe(100_000);
    expect(r.heaviest_weight!.previousValueMilli).toBeNull();
  });
  it("is the running best before the holder's workout, even across a non-improving workout", () => {
    const r = byType([
      set({ workoutId: "w1", weightKgMilli: 90_000, reps: 5 }),
      set({ workoutId: "w2", weightKgMilli: 80_000, reps: 5 }),
      set({ workoutId: "w3", weightKgMilli: 95_000, reps: 5 }),
    ]);
    expect(r.heaviest_weight!.workoutId).toBe("w3");
    expect(r.heaviest_weight!.previousValueMilli).toBe(90_000);
  });
  it("previousValue < value whenever non-null", () => {
    for (const rec of computeRecords([
      set({ workoutId: "w1", weightKgMilli: 90_000, reps: 3 }),
      set({ workoutId: "w2", weightKgMilli: 92_500, reps: 8 }),
    ])) {
      if (rec.previousValueMilli !== null) expect(rec.previousValueMilli).toBeLessThan(rec.valueMilli);
    }
  });
});

describe("AC8 — chronology is the input order; workouts must be contiguous", () => {
  it("throws when a workout's sets are not contiguous", () => {
    expect(() =>
      computeRecords([set({ workoutId: "w1" }), set({ workoutId: "w2" }), set({ workoutId: "w1" })]),
    ).toThrow(/contiguous/);
  });
  it("a backdated workout sorted first takes a tie from a later one", () => {
    const backdated = set({ workoutId: "w0", weightKgMilli: 100_000, reps: 5 });
    const later = set({ workoutId: "w1", weightKgMilli: 100_000, reps: 5 });
    expect(byType([backdated, later]).heaviest_weight!.workoutId).toBe("w0");
  });
  it("output is in RECORD_TYPE_VALUES order", () => {
    expect(computeRecords([set({ workoutId: "w1" })]).map((r) => r.recordType)).toEqual([
      "heaviest_weight",
      "best_est_1rm",
      "best_set_volume",
    ]);
  });
});
