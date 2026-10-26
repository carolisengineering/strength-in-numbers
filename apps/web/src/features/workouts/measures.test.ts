import { describe, expect, it } from "vitest";
import { forbiddenMeasuresFor, requiredMeasuresFor } from "@sin/core";
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
