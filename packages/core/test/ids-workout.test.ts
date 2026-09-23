import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isWorkoutExerciseId,
  isWorkoutId,
  parseWorkoutExerciseId,
  parseWorkoutId,
  type WorkoutExerciseId,
  type WorkoutId,
} from "../src/index.js";

describe("AC19 — WorkoutId / WorkoutExerciseId brands", () => {
  it("parseWorkoutId accepts a UUID and throws on malformed input", () => {
    expect(() => parseWorkoutId("018fcb3e-3b8a-7d6e-9c1a-000000000001")).not.toThrow();
    expect(() => parseWorkoutId("not-a-uuid")).toThrow();
  });

  it("isWorkoutId / isWorkoutExerciseId are type guards", () => {
    expect(isWorkoutId("018fcb3e-3b8a-7d6e-9c1a-000000000001")).toBe(true);
    expect(isWorkoutId("nope")).toBe(false);
    expect(isWorkoutExerciseId("018fcb3e-3b8a-7d6e-9c1a-000000000002")).toBe(true);
  });

  it("parseWorkoutExerciseId accepts a UUID and throws on malformed input", () => {
    expect(() =>
      parseWorkoutExerciseId("018fcb3e-3b8a-7d6e-9c1a-000000000003"),
    ).not.toThrow();
    expect(() => parseWorkoutExerciseId("")).toThrow();
  });

  it("a raw string is not assignable to WorkoutId, and WorkoutId is not a WorkoutExerciseId", () => {
    expectTypeOf<string>().not.toMatchTypeOf<WorkoutId>();
    expectTypeOf<WorkoutId>().not.toMatchTypeOf<WorkoutExerciseId>();
  });
});
