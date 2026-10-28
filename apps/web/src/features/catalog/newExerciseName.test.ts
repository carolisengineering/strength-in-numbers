import { describe, expect, it } from "vitest";
import { duplicateNewNameKeys, newNameProblem, NEW_NAME_INVALID, NEW_NAME_REQUIRED, NEW_NAME_TOO_LONG } from "./newExerciseName";

describe("20.0 D8 — new-exercise name checks", () => {
  it("names a blank, a too-long and an unusual name; a good name has no problem", () => {
    expect(newNameProblem("")).toBe(NEW_NAME_REQUIRED);
    expect(newNameProblem("   ")).toBe(NEW_NAME_REQUIRED);
    expect(newNameProblem("x".repeat(121))).toBe(NEW_NAME_TOO_LONG);
    expect(newNameProblem("Bench\u0000Press")).toBe(NEW_NAME_INVALID);
    expect(newNameProblem("Echo Bike")).toBeNull();
  });

  it("finds the indexes whose normalized name repeats, never an empty key", () => {
    expect(duplicateNewNameKeys(["Bench", "bench", "Row", "!!"])).toEqual(new Set([0, 1]));
    expect(duplicateNewNameKeys(["!!", "??"])).toEqual(new Set());
    expect(duplicateNewNameKeys([])).toEqual(new Set());
  });
});
