import { describe, expect, it } from "vitest";
import {
  HEVY_TYPE_VALUES,
  MEASURE_RULE_VALUES,
  MODALITY_VALUES,
  canonicalModalityForHevyType,
  defaultMeasureRule,
  hevyPairingProblem,
  hevyTypeForModality,
} from "../src/index.js";

describe("19.0 AC4 — canonical modality", () => {
  it.each([
    ["weight_reps", "weight_reps"],
    ["reps_only", "bodyweight_reps"],
    ["bodyweight_reps", "weighted_bodyweight"],
    ["duration", "duration"],
    ["weight_duration", "weight_duration"],
    ["distance_duration", "distance_duration"],
    ["short_distance_weight", "weight_distance"],
    ["bodyweight_assisted_reps", null],
  ] as const)("%s → %s", (hevyType, modality) => {
    expect(canonicalModalityForHevyType(hevyType)).toBe(modality);
  });
});

describe("19.0 AC4 — the 8 × 8 × 3 table", () => {
  // Written out by hand: the 03.4 compatibility table (only weight_reps ↔ weighted_bodyweight cross) applied to
  // each canonical modality, plus the two rule rows.
  const ALLOWED = [
    "bodyweight_assisted_reps|bodyweight_reps|assist_weight_ignored",
    "bodyweight_reps|weight_reps|",
    "bodyweight_reps|weighted_bodyweight|",
    "distance_duration|distance_duration|",
    "duration|duration|",
    "reps_only|bodyweight_reps|",
    "reps_only|calories|calories_as_reps",
    "short_distance_weight|weight_distance|",
    "weight_duration|weight_duration|",
    "weight_reps|weight_reps|",
    "weight_reps|weighted_bodyweight|",
  ];

  it("allows exactly the listed combinations", () => {
    const allowed: string[] = [];
    for (const hevyType of HEVY_TYPE_VALUES) {
      for (const modality of MODALITY_VALUES) {
        for (const rule of [null, ...MEASURE_RULE_VALUES]) {
          if (hevyPairingProblem(hevyType, modality, rule) === null) allowed.push(`${hevyType}|${modality}|${rule ?? ""}`);
        }
      }
    }
    expect(allowed.sort()).toEqual(ALLOWED);
  });

  it.each([
    ["reps_only", "calories", null, "rule_required"],
    ["reps_only", "weight_reps", "calories_as_reps", "rule_not_allowed"],
    ["weight_reps", "weight_reps", "assist_weight_ignored", "rule_not_allowed"],
    ["bodyweight_assisted_reps", "bodyweight_reps", null, "type_mismatch"],
    ["duration", "weight_reps", null, "type_mismatch"],
  ] as const)("(%s, %s, %s) is %s", (hevyType, modality, rule, problem) => {
    expect(hevyPairingProblem(hevyType, modality, rule)).toBe(problem);
  });
});

describe("19.0 AC5 — defaultMeasureRule", () => {
  it.each([
    ["Rower (calories)", "reps_only", "calories_as_reps"],
    ["BIKE (CALORIES)", "reps_only", "calories_as_reps"],
    ["Rower (calories)", "duration", null],
    ["Calories burned", "reps_only", null],
    ["Bench Press (Barbell)", "weight_reps", null],
  ] as const)("(%s, %s) → %s", (title, hevyType, rule) => {
    expect(defaultMeasureRule(title, hevyType)).toBe(rule);
  });
});

describe("19.0 AC15 — hevyTypeForModality", () => {
  it.each([
    ["weight_reps", "weight_reps"],
    ["bodyweight_reps", "reps_only"],
    ["weighted_bodyweight", "bodyweight_reps"],
    ["duration", "duration"],
    ["distance_duration", "distance_duration"],
    ["weight_duration", "weight_duration"],
    ["weight_distance", "short_distance_weight"],
    ["calories", "reps_only"],
  ] as const)("%s → %s", (modality, hevyType) => {
    expect(hevyTypeForModality(modality)).toBe(hevyType);
  });

  it("covers every SIN modality", () => {
    expect(MODALITY_VALUES.every((m) => HEVY_TYPE_VALUES.includes(hevyTypeForModality(m)))).toBe(true);
  });
});
