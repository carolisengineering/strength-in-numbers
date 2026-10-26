import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeRecords,
  estimate1rm,
  milliToDecimalString,
  parseDecimalMilli,
  parseWeightKgMilli,
  setRecordValueMilli,
  type RecordSet,
} from "../src/records.js";
import { MODALITY_VALUES, RECORD_TYPE_VALUES } from "../src/enums.js";

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

type Expect = Partial<Record<(typeof RECORD_TYPE_VALUES)[number], number>>;
const NONE: Expect = {};

/** One representative working set per modality, with every measure that
 * modality carries; the expected values are spec 05.3 §6.2's table. */
const FULL: Record<(typeof MODALITY_VALUES)[number], [Partial<RecordSet>, Expect]> = {
  weight_reps: [{ weightKgMilli: 100_000, reps: 5 }, { heaviest_weight: 100_000, best_est_1rm: 116_667, best_set_volume: 500_000 }],
  bodyweight_reps: [{ weightKgMilli: null, reps: 12 }, { max_reps: 12_000 }],
  weighted_bodyweight: [{ weightKgMilli: 10_000, reps: 8 }, { heaviest_weight: 10_000, best_est_1rm: 12_667, best_set_volume: 80_000 }],
  duration: [{ weightKgMilli: null, reps: null, durationS: 600 }, NONE],
  distance_duration: [{ weightKgMilli: null, reps: null, distanceMMilli: 5_000_000, durationS: 1_500 }, NONE],
  calories: [{ weightKgMilli: null, reps: null, calories: 20 }, { max_calories: 20_000 }],
  weight_distance: [{ weightKgMilli: 24_000, reps: null, distanceMMilli: 40_000 }, { heaviest_weight: 24_000, max_distance: 40_000 }],
  weight_duration: [{ weightKgMilli: 20_000, reps: null, durationS: 90 }, { heaviest_weight: 20_000, max_duration: 90_000 }],
};

const valuesOf = (over: Partial<RecordSet>): Expect => {
  const s = set({ workoutId: "w1", ...over });
  const out: Expect = {};
  for (const t of RECORD_TYPE_VALUES) {
    const v = setRecordValueMilli(t, s);
    if (v !== null) out[t] = v;
  }
  return out;
};

describe("05.3 AC22 — eligibility matrix", () => {
  it.each(MODALITY_VALUES)("%s: the full set gives exactly the §6.2 row", (modality) => {
    const [over, expected] = FULL[modality];
    expect(valuesOf({ modality, ...over })).toEqual(expected);
  });

  it.each([
    ["weight_distance 24 kg × 40 m", { modality: "weight_distance", weightKgMilli: 24_000, reps: null, distanceMMilli: 40_000 }, { heaviest_weight: 24_000, max_distance: 40_000 }],
    ["weight_distance weight 0 still wins distance (D6)", { modality: "weight_distance", weightKgMilli: 0, reps: null, distanceMMilli: 40_000 }, { max_distance: 40_000 }],
    ["weight_distance weight null still wins distance", { modality: "weight_distance", weightKgMilli: null, reps: null, distanceMMilli: 40_000 }, { max_distance: 40_000 }],
    ["weight_distance distance 0 gives nothing", { modality: "weight_distance", weightKgMilli: 24_000, reps: null, distanceMMilli: 0 }, NONE],
    ["weight_distance distance null gives nothing", { modality: "weight_distance", weightKgMilli: 24_000, reps: null, distanceMMilli: null }, NONE],
    ["weight_distance 0.001 m records", { modality: "weight_distance", weightKgMilli: 24_000, reps: null, distanceMMilli: 1 }, { heaviest_weight: 24_000, max_distance: 1 }],
    ["weight_distance ignores stray reps", { modality: "weight_distance", weightKgMilli: 24_000, reps: 5, distanceMMilli: 40_000 }, { heaviest_weight: 24_000, max_distance: 40_000 }],
    ["weight_duration 20 kg × 1 s", { modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: 1 }, { heaviest_weight: 20_000, max_duration: 1_000 }],
    ["weight_duration weight 0 still wins duration", { modality: "weight_duration", weightKgMilli: 0, reps: null, durationS: 90 }, { max_duration: 90_000 }],
    ["weight_duration duration 0 gives nothing", { modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: 0 }, NONE],
    ["weight_duration duration null gives nothing", { modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: null }, NONE],
    ["weight_duration at the DTO maximum", { modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: 2_147_483_647 }, { heaviest_weight: 20_000, max_duration: 2_147_483_647_000 }],
    ["calories 0 gives nothing", { modality: "calories", weightKgMilli: null, reps: null, calories: 0 }, NONE],
    ["calories null gives nothing", { modality: "calories", weightKgMilli: null, reps: null, calories: null }, NONE],
    ["calories 1", { modality: "calories", weightKgMilli: null, reps: null, calories: 1 }, { max_calories: 1_000 }],
    ["calories 32767", { modality: "calories", weightKgMilli: null, reps: null, calories: 32_767 }, { max_calories: 32_767_000 }],
    ["calories ignores stray weight and reps", { modality: "calories", weightKgMilli: 50_000, reps: 5, calories: 20 }, { max_calories: 20_000 }],
    ["weight_reps ignores stray calories, distance, duration", { modality: "weight_reps", weightKgMilli: 100_000, reps: 5, calories: 20, distanceMMilli: 40_000, durationS: 90 }, { heaviest_weight: 100_000, best_est_1rm: 116_667, best_set_volume: 500_000 }],
    ["duration never records max_duration", { modality: "duration", weightKgMilli: null, reps: null, durationS: 600 }, NONE],
    ["distance_duration never records max_distance", { modality: "distance_duration", weightKgMilli: null, reps: null, distanceMMilli: 5_000_000, durationS: 1_500 }, NONE],
  ] as const)("%s", (_label, over, expected) => {
    expect(valuesOf(over as Partial<RecordSet>)).toEqual(expected);
  });

  it("e1RM, set volume and max reps are never produced for a new type", () => {
    for (const modality of ["calories", "weight_distance", "weight_duration"] as const) {
      const s = set({ workoutId: "w1", modality, weightKgMilli: 100_000, reps: 5, calories: 20, distanceMMilli: 40_000, durationS: 90 });
      for (const t of ["best_est_1rm", "best_set_volume", "max_reps"] as const) {
        expect(setRecordValueMilli(t, s)).toBeNull();
      }
    }
  });
});

describe("05.3 AC23 — calories records", () => {
  it("one max_calories record; the earliest wins a tie; previous is the best of earlier workouts", () => {
    const cal = (workoutId: string, calories: number) => set({ workoutId, modality: "calories", weightKgMilli: null, reps: null, calories });
    const a = cal("w1", 20);
    const b = cal("w2", 25);
    const c = cal("w3", 25);
    const records = computeRecords([a, b, c]);
    expect(records).toEqual([
      { recordType: "max_calories", valueMilli: 25_000, unit: "cal", setId: b.setId, workoutId: "w2", previousValueMilli: 20_000 },
    ]);
  });
});

describe("05.3 AC24 — weight + distance", () => {
  it("heaviest_weight and max_distance have independent holders", () => {
    const a = set({ workoutId: "w1", modality: "weight_distance", weightKgMilli: 40_000, reps: null, distanceMMilli: 20_000 });
    const b = set({ workoutId: "w2", modality: "weight_distance", weightKgMilli: 24_000, reps: null, distanceMMilli: 60_000 });
    const r = byType([a, b]);
    expect(Object.keys(r).sort()).toEqual(["heaviest_weight", "max_distance"]);
    expect(r.heaviest_weight).toMatchObject({ setId: a.setId, valueMilli: 40_000, unit: "kg", previousValueMilli: null });
    expect(r.max_distance).toMatchObject({ setId: b.setId, valueMilli: 60_000, unit: "m", previousValueMilli: 20_000 });
  });
});

describe("05.3 AC25 — weight + duration", () => {
  it("heaviest_weight and max_duration have independent holders", () => {
    const a = set({ workoutId: "w1", modality: "weight_duration", weightKgMilli: 40_000, reps: null, durationS: 30 });
    const b = set({ workoutId: "w2", modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: 90 });
    const r = byType([a, b]);
    expect(Object.keys(r).sort()).toEqual(["heaviest_weight", "max_duration"]);
    expect(r.heaviest_weight).toMatchObject({ setId: a.setId, valueMilli: 40_000, unit: "kg", previousValueMilli: null });
    expect(r.max_duration).toMatchObject({ setId: b.setId, valueMilli: 90_000, unit: "s", previousValueMilli: 30_000 });
  });
});

describe("05.3 AC26 — legacy unchanged, mixed snapshots", () => {
  it("each set is judged under its own snapshot: old duration sets give no max_duration", () => {
    const old = set({ workoutId: "w1", modality: "duration", weightKgMilli: null, reps: null, durationS: 600 });
    const now = set({ workoutId: "w2", modality: "weight_duration", weightKgMilli: 20_000, reps: null, durationS: 90 });
    const r = byType([old, now]);
    expect(Object.keys(r).sort()).toEqual(["heaviest_weight", "max_duration"]);
    expect(r.max_duration).toMatchObject({ setId: now.setId, valueMilli: 90_000, previousValueMilli: null });
    expect(r.heaviest_weight).toMatchObject({ setId: now.setId, valueMilli: 20_000, previousValueMilli: null });
  });
});

describe("05.3 AC35 — parseDecimalMilli is parseWeightKgMilli under a neutral name", () => {
  it("is the same function: exact meters from Postgres text", () => {
    expect(parseDecimalMilli).toBe(parseWeightKgMilli);
    expect(parseDecimalMilli("30.480")).toBe(30_480);
    expect(parseDecimalMilli("999999.999")).toBe(999_999_999);
  });
});
