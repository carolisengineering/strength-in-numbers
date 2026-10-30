import { describe, expect, it } from "vitest";

import { hevyExerciseCreateBody } from "./hevyExerciseCreateBody";

describe("20.2 AC14 — hevyExerciseCreateBody", () => {
  it("translates the muscles and equipment; other muscles leave out the primary and repeats", () => {
    expect(
      hevyExerciseCreateBody({ title: "Echo Bike (calories)", hevyType: "reps_only", primaryMuscle: "core", otherMuscles: ["core", "quads"], equipment: null }),
    ).toEqual({
      exercise: { title: "Echo Bike (calories)", exercise_type: "reps_only", muscle_group: "abdominals", other_muscles: ["quadriceps"], equipment_category: "other" },
    });
  });

  it("an unknown muscle is other; bodyweight equipment is none; the §6.5 examples come out of 19.0's table", () => {
    const body = hevyExerciseCreateBody({ title: "Plank", hevyType: "duration", primaryMuscle: "made-up", otherMuscles: ["back", "back"], equipment: "bodyweight" });
    expect(body.exercise).toMatchObject({ muscle_group: "other", other_muscles: ["upper_back"], equipment_category: "none" });
  });

  it("an empty or whitespace-only title throws", () => {
    expect(() => hevyExerciseCreateBody({ title: "   ", hevyType: "reps_only", primaryMuscle: null, otherMuscles: [], equipment: null })).toThrow();
    expect(() => hevyExerciseCreateBody({ title: "", hevyType: "reps_only", primaryMuscle: null, otherMuscles: [], equipment: null })).toThrow();
  });
});
