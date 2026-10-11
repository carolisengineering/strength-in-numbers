import { describe, expect, it } from "vitest";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { supersetRows } from "./supersetRows";

describe("10.1 AC17 — supersetRows", () => {
  it("sorts by position; bracket, ordinal, label and linkedBelow follow contiguous runs only", () => {
    const w = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", name: "A", supersetGroup: 7, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8 },
        { modality: "weight_reps", name: "B", supersetGroup: 7 },
        { modality: "weight_reps", name: "C" },
        { modality: "weight_reps", name: "D", supersetGroup: 3 },
        { modality: "weight_reps", name: "E", supersetGroup: 3 },
        { modality: "weight_reps", name: "F", supersetGroup: 40 },
      ],
    });
    const rows = supersetRows([...w.exercises].reverse());
    expect(rows.map((r) => r.exercise.exerciseNameSnapshot)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(rows.map((r) => r.bracket)).toEqual(["first", "last", "none", "first", "last", "none"]);
    expect(rows.map((r) => r.ordinal)).toEqual([1, 1, null, 2, 2, null]);
    expect(rows.map((r) => r.label)).toEqual(["A, superset 1, 4 × 6–8", "B, superset 1", null, "D, superset 2", "E, superset 2", null]);
    expect(rows.map((r) => r.linkedBelow)).toEqual([true, false, false, true, false, false]);
  });
});
