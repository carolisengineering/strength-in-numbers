import { describe, expect, it } from "vitest";
import { SET_CALORIES_MAX } from "@sin/core";
import { CALORIES_STEP, caloriesAtLimit, stepCalories } from "./stepper";

describe("18.1 AC6 — calories stepper", () => {
  it("steps by 5 without snapping; blank or unparsable steps from 0", () => {
    expect(CALORIES_STEP).toBe(5);
    expect(stepCalories("20", "up")).toBe("25");
    expect(stepCalories("22", "up")).toBe("27");
    expect(stepCalories("", "up")).toBe("5");
    expect(stepCalories("abc", "up")).toBe("5");
    expect(stepCalories("25", "down")).toBe("20");
  });
  it("clamps at 0 and at SET_CALORIES_MAX", () => {
    expect(stepCalories("3", "down")).toBe("0");
    expect(stepCalories("32765", "up")).toBe(String(SET_CALORIES_MAX));
  });
  it("Review Focus 2 — − on a value typed above the max gives the max, never negative or NaN", () => {
    expect(stepCalories("40000", "down")).toBe(String(SET_CALORIES_MAX));
    expect(caloriesAtLimit("40000", "up")).toBe(true);
  });
  it("caloriesAtLimit", () => {
    expect(caloriesAtLimit("0", "down")).toBe(true);
    expect(caloriesAtLimit("", "down")).toBe(true);
    expect(caloriesAtLimit(String(SET_CALORIES_MAX), "up")).toBe(true);
    expect(caloriesAtLimit("20", "up")).toBe(false);
    expect(caloriesAtLimit("20", "down")).toBe(false);
  });
});
