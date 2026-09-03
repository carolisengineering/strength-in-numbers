import { describe, expect, it } from "vitest";
import {
  DISTANCE_UNIT_VALUES,
  MODALITY_VALUES,
  RECORD_TYPE_VALUES,
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

  it("DISTANCE_UNIT_VALUES = m | km | mi (DESIGN §4.0)", () => {
    expect([...DISTANCE_UNIT_VALUES]).toEqual(["m", "km", "mi"]);
  });

  it("MODALITY_VALUES matches the DESIGN §4.2 exercise.modality list", () => {
    expect([...MODALITY_VALUES]).toEqual([
      "weight_reps",
      "bodyweight_reps",
      "weighted_bodyweight",
      "duration",
      "distance_duration",
    ]);
  });

  it("SET_TYPE_VALUES = warmup | working | drop | failure (DESIGN §4.4)", () => {
    expect([...SET_TYPE_VALUES]).toEqual(["warmup", "working", "drop", "failure"]);
  });

  it("RECORD_TYPE_VALUES = the three v1 PR kinds (DESIGN §4.5)", () => {
    expect([...RECORD_TYPE_VALUES]).toEqual([
      "heaviest_weight",
      "best_est_1rm",
      "best_set_volume",
    ]);
  });

  it("every *_VALUES array is frozen (single source of truth)", () => {
    for (const arr of [
      UNIT_PREFERENCE_VALUES,
      WEIGHT_UNIT_VALUES,
      DISTANCE_UNIT_VALUES,
      MODALITY_VALUES,
      SET_TYPE_VALUES,
      RECORD_TYPE_VALUES,
    ]) {
      expect(Object.isFrozen(arr)).toBe(true);
    }
  });
});
