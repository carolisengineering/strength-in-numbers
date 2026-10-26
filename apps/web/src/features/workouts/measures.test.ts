import { describe, expect, it } from "vitest";
import { forbiddenMeasuresFor, MODALITY_VALUES, requiredMeasuresFor } from "@sin/core";
import { DISPLAY_ORDER, visibleMeasures } from "./measures";

// The legacy five: the new types' entry fields are Spec 18.1's (05.3 Phase A ships no entry UI for them).
const LEGACY_MODALITIES = ["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"] as const;

describe("AC5 — visible measures are exactly the required measures", () => {
  it.each(LEGACY_MODALITIES)("%s", (modality) => {
    const visible = visibleMeasures(modality);
    expect(new Set(visible)).toEqual(new Set(requiredMeasuresFor(modality)));
    expect(visible.some((m) => forbiddenMeasuresFor(modality).includes(m))).toBe(false);
    const positions = visible.map((m) => DISPLAY_ORDER.indexOf(m));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("weighted_bodyweight shows weight before reps even though core lists reps first", () => {
    expect(visibleMeasures("weighted_bodyweight")).toEqual(["weight", "reps"]);
  });
});

describe("18.1 AC4 — visible measures for all eight types", () => {
  it.each(MODALITY_VALUES)("%s: the required measures, in DISPLAY_ORDER", (modality) => {
    const required = requiredMeasuresFor(modality);
    expect(visibleMeasures(modality)).toEqual(DISPLAY_ORDER.filter((m) => required.includes(m)));
    expect(new Set(visibleMeasures(modality))).toEqual(new Set(required));
  });
  it("DISPLAY_ORDER is weight, distance, reps, durationS, calories", () => {
    expect(DISPLAY_ORDER).toEqual(["weight", "distance", "reps", "durationS", "calories"]);
  });
  it("the new types", () => {
    expect(visibleMeasures("weight_distance")).toEqual(["weight", "distance"]);
    expect(visibleMeasures("weight_duration")).toEqual(["weight", "durationS"]);
    expect(visibleMeasures("calories")).toEqual(["calories"]);
  });
  it.each([
    ["weight_reps", ["weight", "reps"]],
    ["bodyweight_reps", ["reps"]],
    ["weighted_bodyweight", ["weight", "reps"]],
    ["duration", ["durationS"]],
    ["distance_duration", ["distance", "durationS"]],
  ] as const)("%s reads as on main", (modality, expected) => {
    expect(visibleMeasures(modality)).toEqual(expected);
  });
});
