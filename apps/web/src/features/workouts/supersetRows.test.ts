import { describe, expect, it } from "vitest";
import type { PlannedSet } from "@sin/core";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { supersetRows } from "./supersetRows";

const p = (weight: number | null, unit: "kg" | "lb" = "kg"): PlannedSet => ({ setType: "working", repsLow: 8, repsHigh: 8, weight, weightUnit: weight === null ? null : unit });
const lineFor = (o: Record<string, unknown>) =>
  supersetRows(makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", ...o }] }).exercises)[0]!.line;

describe("10.2 AC29 — the target line carries the planned weight", () => {
  it("a uniform plan: '4 × 6–8 @ 100 kg · RPE 8'", () => {
    expect(lineFor({ targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8, plannedSets: [p(100), p(100), p(100), p(100)] })).toBe("4 × 6–8 @ 100 kg · RPE 8");
  });
  it("a ramp reads as a range", () => {
    expect(lineFor({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, plannedSets: [p(60), p(80), p(100)] })).toBe("3 × 6–10 @ 60–100 kg");
  });
  it("mixed units and weightless plans add nothing", () => {
    expect(lineFor({ targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, plannedSets: [p(60), p(135, "lb")] })).toBe("2 × 5");
    expect(lineFor({ targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, plannedSets: [p(null), p(null)] })).toBe("2 × 5");
  });
  it("no plan is exactly today's line", () => {
    expect(lineFor({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8, restSeconds: 120 })).toBe("3 × 8–10 · RPE 8 · 2:00");
    expect(lineFor({})).toBe("");
  });
  it("the card's accessible label (a card in a superset run) carries the weight too", () => {
    const exercises = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", name: "Bench", supersetGroup: 1, targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, plannedSets: [p(100), p(100)] },
        { modality: "weight_reps", name: "Row", supersetGroup: 1 },
      ],
    }).exercises;
    expect(supersetRows(exercises)[0]!.label).toBe("Bench, superset 1, 2 × 5 @ 100 kg");
  });
});
