import { describe, expect, it } from "vitest";
import {
  HEVY_LINK_CLAIM_TTL_S,
  HEVY_LINK_ORIGIN_VALUES,
  HEVY_PAIRS_MAX,
  HEVY_RPE_STEPS,
  HEVY_SECTION_RULES_MAX,
  HEVY_SET_TYPE_VALUES,
  HEVY_TYPE_VALUES,
  MEASURE_RULE_VALUES,
  PAIR_ROLE_VALUES,
  SECTION_TREATMENT_VALUES,
} from "../src/index.js";

describe("19.0 AC1 — vocabulary", () => {
  it.each([
    [
      "HEVY_TYPE_VALUES",
      HEVY_TYPE_VALUES,
      [
        "weight_reps",
        "reps_only",
        "bodyweight_reps",
        "bodyweight_assisted_reps",
        "duration",
        "weight_duration",
        "distance_duration",
        "short_distance_weight",
      ],
    ],
    ["HEVY_SET_TYPE_VALUES", HEVY_SET_TYPE_VALUES, ["warmup", "normal", "failure", "dropset"]],
    ["HEVY_RPE_STEPS", HEVY_RPE_STEPS, [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]],
    ["MEASURE_RULE_VALUES", MEASURE_RULE_VALUES, ["calories_as_reps", "assist_weight_ignored"]],
    ["PAIR_ROLE_VALUES", PAIR_ROLE_VALUES, ["exercise", "skip", "warmup_placeholder", "workout_placeholder"]],
    ["SECTION_TREATMENT_VALUES", SECTION_TREATMENT_VALUES, ["warmup_placeholder", "workout_placeholder", "notes_on_first"]],
    ["HEVY_LINK_ORIGIN_VALUES", HEVY_LINK_ORIGIN_VALUES, ["sent", "imported", "matched"]],
  ] as const)("%s is frozen, in this exact order", (_name, list, expected) => {
    expect(list).toEqual(expected);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it("the limits", () => {
    expect(HEVY_PAIRS_MAX).toBe(2000);
    expect(HEVY_SECTION_RULES_MAX).toBe(20);
    expect(HEVY_LINK_CLAIM_TTL_S).toBe(120);
  });
});
