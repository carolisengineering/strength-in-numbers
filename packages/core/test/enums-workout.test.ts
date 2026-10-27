import { describe, expect, it } from "vitest";
import { WORKOUT_SOURCE_VALUES, WorkoutSchema } from "../src/index.js";

describe("19.0 AC2 — WORKOUT_SOURCE_VALUES", () => {
  it("is frozen and contains exactly 'manual' and 'hevy'", () => {
    expect(Object.isFrozen(WORKOUT_SOURCE_VALUES)).toBe(true);
    expect(WORKOUT_SOURCE_VALUES).toEqual(["manual", "hevy"]);
  });

  it("WorkoutSchema.source accepts 'hevy' and rejects an unknown source", () => {
    expect(WorkoutSchema.shape.source.safeParse("hevy").success).toBe(true);
    expect(WorkoutSchema.shape.source.safeParse("manual").success).toBe(true);
    expect(WorkoutSchema.shape.source.safeParse("strava").success).toBe(false);
  });
});
