import { MODALITY_VALUES } from "@sin/core";
import { describe, expect, it } from "vitest";
import { MODALITY_HINTS, MODALITY_LABELS } from "./labels";

describe("18.1 AC2 — labels", () => {
  it("MODALITY_LABELS is the eight labels, in MODALITY_VALUES order", () => {
    expect(MODALITY_VALUES.map((m) => MODALITY_LABELS[m])).toEqual([
      "Weight × reps",
      "Bodyweight × reps",
      "Weighted bodyweight",
      "Duration",
      "Distance + duration",
      "Calories",
      "Weight + distance",
      "Weight + duration",
    ]);
  });
});

describe("18.1 AC3 — hints", () => {
  it("every type has the §6.1 hint, verbatim", () => {
    expect(MODALITY_VALUES.map((m) => MODALITY_HINTS[m])).toEqual([
      "Weight and reps, like a squat.",
      "Reps only, like a pull-up.",
      "Added weight and reps, like a weighted dip.",
      "Time only, like a plank.",
      "Distance and time, like a row or a run.",
      "Calories only, like an Echo Bike.",
      "Weight and distance, like a farmer carry.",
      "Weight and time, like a weighted hold.",
    ]);
  });
});
