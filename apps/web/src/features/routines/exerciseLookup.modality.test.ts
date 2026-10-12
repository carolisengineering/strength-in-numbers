import { describe, expect, it } from "vitest";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { lookupIn } from "./exerciseLookup";

describe("10.2 AC9 — the lookup carries the exercise's modality", () => {
  const rows = [
    makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" }),
    makeExercise({ id: exerciseId(2), name: "Plank", modality: "duration" }),
    makeExercise({ id: exerciseId(3), name: "Old Row", isActive: false, modality: "bodyweight_reps" }),
  ];
  it("present for any row the catalog holds, retired included", () => {
    const lookup = lookupIn(rows, { synced: true });
    expect(lookup(exerciseId(1)).modality).toBe("weight_reps");
    expect(lookup(exerciseId(2)).modality).toBe("duration");
    expect(lookup(exerciseId(3)).modality).toBe("bodyweight_reps");
  });
  it("null when the catalog does not hold the exercise (unsynced or missing)", () => {
    expect(lookupIn(rows, { synced: false })(exerciseId(99)).modality).toBeNull();
    expect(lookupIn(rows, { synced: true })(exerciseId(99)).modality).toBeNull();
  });
});
