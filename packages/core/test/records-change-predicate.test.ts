import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, type Modality } from "../src/enums.js";
import { RECORD_MEASURES_BY_MODALITY, setChangeAffectsRecords, type RecordRelevantSet } from "../src/records.js";

const working = (over: Partial<RecordRelevantSet> = {}): RecordRelevantSet => ({
  setType: "working",
  modality: "weight_reps",
  reps: 5,
  weightKgMilli: 100_000,
  distanceMMilli: null,
  durationS: null,
  calories: null,
  ...over,
});
const warmup = (over: Partial<RecordRelevantSet> = {}): RecordRelevantSet => ({ ...working(over), setType: "warmup", ...over });

describe("07.4 AC8 — setChangeAffectsRecords", () => {
  it.each<[string, RecordRelevantSet | null, RecordRelevantSet | null, boolean]>([
    ["nothing before or after", null, null, false],
    ["create a non-working set", null, warmup(), false],
    ["delete a non-working set", warmup(), null, false],
    ["working → working, nothing relevant changed", working(), working(), false],
    ["warm-up → warm-up with new numbers", warmup(), warmup({ reps: 9, weightKgMilli: 1 }), false],
    ["create a working set", null, working(), true],
    ["delete a working set", working(), null, true],
    ["working → warm-up (demote)", working(), warmup(), true],
    ["warm-up → working (promote)", warmup(), working(), true],
    ["reps change", working(), working({ reps: 6 }), true],
    ["weight change", working(), working({ weightKgMilli: 100_001 }), true],
    ["weight null → number", working({ weightKgMilli: null }), working(), true],
    ["reps number → null", working(), working({ reps: null }), true],
  ])("%s", (_name, before, after, expected) => {
    expect(setChangeAffectsRecords(before, after)).toBe(expected);
  });
});

type Field = "reps" | "weightKgMilli" | "distanceMMilli" | "durationS" | "calories";
/** Each measure name in RECORD_MEASURES_BY_MODALITY and the predicate field it reads. */
const FIELD: Record<"reps" | "weight" | "distance" | "duration" | "calories", Field> = {
  reps: "reps",
  weight: "weightKgMilli",
  distance: "distanceMMilli",
  duration: "durationS",
  calories: "calories",
};
/** Spec 05.3 §6.4, written out independently of the implementation. */
const EXPECTED: Record<Modality, readonly Field[]> = {
  weight_reps: ["reps", "weightKgMilli"],
  bodyweight_reps: ["reps"],
  weighted_bodyweight: ["reps", "weightKgMilli"],
  duration: [],
  distance_duration: [],
  calories: ["calories"],
  weight_distance: ["weightKgMilli", "distanceMMilli"],
  weight_duration: ["weightKgMilli", "durationS"],
};
const ALL_FIELDS: readonly Field[] = ["reps", "weightKgMilli", "distanceMMilli", "durationS", "calories"];
const base = (modality: Modality, setType: "working" | "warmup" = "working"): RecordRelevantSet => ({
  setType,
  modality,
  reps: 5,
  weightKgMilli: 20_000,
  distanceMMilli: 40_000,
  durationS: 90,
  calories: 20,
});

describe("05.3 AC29 — predicate truth table", () => {
  it("RECORD_MEASURES_BY_MODALITY is the §6.4 table", () => {
    for (const m of MODALITY_VALUES) {
      expect(RECORD_MEASURES_BY_MODALITY[m].map((k) => FIELD[k])).toEqual(EXPECTED[m]);
    }
  });

  const rows: [string, RecordRelevantSet | null, RecordRelevantSet | null, boolean][] = [];
  for (const m of MODALITY_VALUES) {
    for (const f of ALL_FIELDS) {
      const listed = EXPECTED[m].includes(f);
      rows.push([`${m}: ${f} changes (working)`, base(m), { ...base(m), [f]: 7 }, listed]);
      rows.push([`${m}: ${f} → null (working)`, base(m), { ...base(m), [f]: null }, listed]);
      rows.push([`${m}: ${f} changes (warm-up)`, base(m, "warmup"), { ...base(m, "warmup"), [f]: 7 }, false]);
    }
    rows.push([`${m}: nothing changes (rpe-only)`, base(m), base(m), false]);
    rows.push([`${m}: working → warm-up`, base(m), base(m, "warmup"), true]);
    rows.push([`${m}: warm-up → working`, base(m, "warmup"), base(m), true]);
    rows.push([`${m}: create working`, null, base(m), true]);
    rows.push([`${m}: delete working`, base(m), null, true]);
    rows.push([`${m}: create warm-up`, null, base(m, "warmup"), false]);
    rows.push([`${m}: delete warm-up`, base(m, "warmup"), null, false]);
  }
  it.each(rows)("%s", (_name, before, after, expected) => {
    expect(setChangeAffectsRecords(before, after)).toBe(expected);
  });

  it.each<[string, RecordRelevantSet, RecordRelevantSet, boolean]>([
    ["legacy distance_duration distance change recomputes nothing (07.4 AC8)", base("distance_duration"), { ...base("distance_duration"), distanceMMilli: 50_000 }, false],
    ["legacy duration duration change recomputes nothing (07.4 AC8)", base("duration"), { ...base("duration"), durationS: 600 }, false],
    ["bodyweight_reps weight change recomputes nothing (now exact)", base("bodyweight_reps"), { ...base("bodyweight_reps"), weightKgMilli: 30_000 }, false],
    ["calories 20 → 30 recomputes", base("calories"), { ...base("calories"), calories: 30 }, true],
  ])("%s", (_name, before, after, expected) => {
    expect(setChangeAffectsRecords(before, after)).toBe(expected);
  });
});
