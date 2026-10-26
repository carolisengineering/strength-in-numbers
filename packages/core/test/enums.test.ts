import { describe, expect, it } from "vitest";
import {
  DISTANCE_UNIT_VALUES,
  MODALITY_VALUES,
  RECORD_TYPE_VALUES,
  RECORD_UNIT_BY_TYPE,
  RECORD_UNIT_VALUES,
  SET_TYPE_VALUES,
  UNIT_PREFERENCE_VALUES,
  WEIGHT_UNIT_VALUES,
} from "../src/enums.js";

describe("AC4 — shared enums match DESIGN §4.0–4.5", () => {
  it("UNIT_PREFERENCE_VALUES = kg | lb (DESIGN §4.1)", () => {
    expect([...UNIT_PREFERENCE_VALUES]).toEqual(["kg", "lb"]);
  });

  it("WEIGHT_UNIT_VALUES = kg | lb (DESIGN §4.8)", () => {
    expect([...WEIGHT_UNIT_VALUES]).toEqual(["kg", "lb"]);
  });

  it("05.3 AC39 — DISTANCE_UNIT_VALUES = m | km | mi | ft (DESIGN §4.0, legacy order kept)", () => {
    expect([...DISTANCE_UNIT_VALUES]).toEqual(["m", "km", "mi", "ft"]);
  });

  it("05.3 AC1 — MODALITY_VALUES is the legacy five, then the three new types", () => {
    expect([...MODALITY_VALUES]).toEqual([
      "weight_reps",
      "bodyweight_reps",
      "weighted_bodyweight",
      "duration",
      "distance_duration",
      "calories",
      "weight_distance",
      "weight_duration",
    ]);
  });

  it("SET_TYPE_VALUES = warmup | working | drop | failure (DESIGN §4.4)", () => {
    expect([...SET_TYPE_VALUES]).toEqual(["warmup", "working", "drop", "failure"]);
  });

  it("05.3 AC2 — RECORD_TYPE_VALUES = the four v1 PR kinds, then max_calories, max_distance, max_duration", () => {
    expect([...RECORD_TYPE_VALUES]).toEqual([
      "heaviest_weight",
      "best_est_1rm",
      "best_set_volume",
      "max_reps",
      "max_calories",
      "max_distance",
      "max_duration",
    ]);
  });

  it("05.3 AC2 — RECORD_UNIT_VALUES and RECORD_UNIT_BY_TYPE pair every type with exactly one unit", () => {
    expect([...RECORD_UNIT_VALUES]).toEqual(["kg", "kg_reps", "reps", "cal", "m", "s"]);
    expect(RECORD_UNIT_BY_TYPE).toEqual({
      heaviest_weight: "kg",
      best_est_1rm: "kg",
      best_set_volume: "kg_reps",
      max_reps: "reps",
      max_calories: "cal",
      max_distance: "m",
      max_duration: "s",
    });
    expect(Object.keys(RECORD_UNIT_BY_TYPE)).toEqual([...RECORD_TYPE_VALUES]);
    expect(Object.isFrozen(RECORD_UNIT_BY_TYPE)).toBe(true);
  });

  it("every *_VALUES array is frozen (single source of truth)", () => {
    for (const arr of [
      UNIT_PREFERENCE_VALUES,
      WEIGHT_UNIT_VALUES,
      DISTANCE_UNIT_VALUES,
      MODALITY_VALUES,
      SET_TYPE_VALUES,
      RECORD_TYPE_VALUES,
      RECORD_UNIT_VALUES,
    ]) {
      expect(Object.isFrozen(arr)).toBe(true);
    }
  });
});
