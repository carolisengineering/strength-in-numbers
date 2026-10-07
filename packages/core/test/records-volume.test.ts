import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeRecords, parseWeightKgMilli, setVolumeMilli, sumVolumeMilli } from "../src/records.js";

describe("AC15 — setVolumeMilli is the one definition of a set's volume", () => {
  it("reps × weightKgMilli for both load modalities", () => {
    expect(setVolumeMilli("weight_reps", 100_000, 5)).toBe(500_000);
    expect(setVolumeMilli("weighted_bodyweight", 20_000, 8)).toBe(160_000);
  });
  it("an lb-derived weight uses its canonical milli value", () => {
    // 135 lb → weight_kg 61.235 (numeric(7,3)) → 61235 milli × 3 = 183705
    expect(setVolumeMilli("weight_reps", parseWeightKgMilli("61.235"), 3)).toBe(183_705);
  });
  it.each([
    ["weight_reps", 100_000, 0],
    ["weight_reps", 100_000, null],
    ["weight_reps", 0, 5],
    ["weight_reps", null, 5],
    ["weight_reps", 100_000, 2.5],
    ["bodyweight_reps", null, 10],
    ["duration", null, null],
    ["distance_duration", null, null],
  ] as const)("%s weight=%s reps=%s is ineligible → null", (modality, w, reps) => {
    expect(setVolumeMilli(modality, w, reps)).toBeNull();
  });
});

describe("AC15 — sumVolumeMilli", () => {
  it("sums only qualifying sets, exactly", () => {
    expect(
      sumVolumeMilli([
        { modality: "weight_reps", weightKgMilli: 100_000, reps: 5 }, // 500000
        { modality: "weight_reps", weightKgMilli: 61_235, reps: 3 }, // 183705
        { modality: "weighted_bodyweight", weightKgMilli: 20_000, reps: 8 }, // 160000
        { modality: "bodyweight_reps", weightKgMilli: null, reps: 12 }, // ineligible
        { modality: "weight_reps", weightKgMilli: null, reps: 5 }, // Review Focus 5
      ]),
    ).toBe(843_705);
  });
  it("null when nothing qualifies (cardio-only, bodyweight-only, zeros, empty)", () => {
    expect(sumVolumeMilli([])).toBeNull();
    expect(sumVolumeMilli([{ modality: "duration", weightKgMilli: null, reps: null }])).toBeNull();
    expect(sumVolumeMilli([{ modality: "bodyweight_reps", weightKgMilli: null, reps: 10 }])).toBeNull();
    expect(sumVolumeMilli([{ modality: "weight_reps", weightKgMilli: 100_000, reps: 0 }])).toBeNull();
    expect(sumVolumeMilli([{ modality: "weight_reps", weightKgMilli: null, reps: null }])).toBeNull();
  });
  it("accepts any iterable", () => {
    function* gen() {
      yield { modality: "weight_reps", weightKgMilli: 1_000, reps: 1 };
    }
    expect(sumVolumeMilli(gen())).toBe(1_000);
  });
});

describe("AC15 — computeRecords' best_set_volume goes through setVolumeMilli (no second definition)", () => {
  it("records.ts multiplies reps by a weight in exactly one place", () => {
    const src = readFileSync(new URL("../src/records.ts", import.meta.url), "utf8");
    expect(src.match(/reps \* w/g) ?? []).toHaveLength(1);
  });
  it("setRecordValueMilli (was candidate) hands best_set_volume to setVolumeMilli before any other eligibility guard (no second copy of the rule)", () => {
    const src = readFileSync(new URL("../src/records.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("function setRecordValueMilli("));
    const volumeBranch = body.indexOf('recordType === "best_set_volume"');
    const loadGuard = body.indexOf("LOAD_MODALITIES.has(s.modality)");
    expect(volumeBranch).toBeGreaterThan(-1);
    expect(volumeBranch).toBeLessThan(loadGuard);
    expect(body).toContain("setVolumeMilli(s.modality, s.weightKgMilli, s.reps)");
  });
  it("best_set_volume equals setVolumeMilli for the record's set", () => {
    const [vol] = computeRecords([
      { setId: "a", workoutId: "w", modality: "weight_reps", weightKgMilli: 61_235, reps: 3 },
    ]).filter((r) => r.recordType === "best_set_volume");
    expect(vol!.valueMilli).toBe(setVolumeMilli("weight_reps", 61_235, 3));
  });
});
