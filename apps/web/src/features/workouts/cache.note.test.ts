import { describe, expect, it } from "vitest";
import type { WorkoutExercise } from "@sin/core";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { withExerciseNotes } from "./cache";

describe("10.3 AC28 — withExerciseNotes", () => {
  const detail = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "A", notes: "old" }, { modality: "weight_reps", name: "B" }] });
  const [a, b] = detail.exercises;
  it("replaces only notes and updatedAt of the matching exercise", () => {
    const out = withExerciseNotes(detail, { id: a!.id, notes: "new", updatedAt: "2026-10-03T10:00:00.000Z" });
    expect(out.exercises[0]).toEqual({ ...a, notes: "new", updatedAt: "2026-10-03T10:00:00.000Z" });
    expect(out.exercises[1]).toBe(b);
  });
  it("returns the same detail for an unknown exercise or an identical value", () => {
    expect(withExerciseNotes(detail, { id: "nope" as WorkoutExercise["id"], notes: "x", updatedAt: a!.updatedAt })).toBe(detail);
    expect(withExerciseNotes(detail, { id: a!.id, notes: "old", updatedAt: a!.updatedAt })).toBe(detail);
  });
});
