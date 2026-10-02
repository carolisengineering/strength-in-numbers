import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, forbiddenMeasuresFor, requiredMeasuresFor } from "@sin/core";
import { DISPLAY_ORDER, visibleMeasures } from "./measures";

describe("AC5 — visible measures are exactly the required measures", () => {
  it.each(MODALITY_VALUES)("%s", (modality) => {
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
