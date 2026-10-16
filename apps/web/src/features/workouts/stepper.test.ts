import { SET_REPS_MAX } from "@sin/core";
import { describe, expect, it } from "vitest";

import { WEIGHT_STEP, repsAtLimit, stepReps, stepWeight, weightAtLimit, type StepDirection } from "./stepper";

describe("17.1 AC18 — the weight stepper", () => {
  it("steps 5 for lb and 2.5 for kg (D5)", () => {
    expect(WEIGHT_STEP).toEqual({ lb: 5, kg: 2.5 });
  });

  it.each<[string, "kg" | "lb", StepDirection, string]>([
    ["185", "lb", "up", "190"],
    ["185", "lb", "down", "180"],
    ["187.5", "kg", "up", "190"],
    ["60", "kg", "down", "57.5"],
    ["0.1", "kg", "up", "2.6"],
    ["102.125", "kg", "up", "104.625"],
    ["62,5", "kg", "up", "65"],
    ["187", "lb", "up", "192"],
    ["2", "lb", "down", "0"],
    ["0", "kg", "down", "0"],
    ["", "lb", "up", "5"],
    ["", "kg", "down", "0"],
    ["abc", "kg", "up", "2.5"],
    ["12.", "lb", "up", "5"],
    ["1.2345", "kg", "up", "2.5"],
    ["-5", "lb", "up", "5"],
    ["9999", "lb", "up", "9999.999"],
    ["10000", "lb", "down", "9995"], // an over-cap typed value steps down by 5 like any other (the result is in range)
  ])("%s %s %s → %s", (text, unit, direction, expected) => {
    expect(stepWeight(text, unit, direction)).toBe(expected);
  });

  it("is at a limit at 0 (down) and at SET_WEIGHT_MAX (up); blank counts as 0", () => {
    expect(weightAtLimit("0", "down")).toBe(true);
    expect(weightAtLimit("", "down")).toBe(true);
    expect(weightAtLimit("2.5", "down")).toBe(false);
    expect(weightAtLimit("9999.999", "up")).toBe(true);
    expect(weightAtLimit("9999.998", "up")).toBe(false);
    expect(weightAtLimit("185", "up")).toBe(false);
  });
});

describe("17.1 AC19 — the reps stepper", () => {
  it.each<[string, StepDirection, string]>([
    ["5", "up", "6"],
    ["5", "down", "4"],
    ["0", "down", "0"],
    ["", "up", "1"],
    ["", "down", "0"],
    ["7.5", "up", "1"],
    [String(SET_REPS_MAX), "up", String(SET_REPS_MAX)],
  ])("%s %s → %s", (text, direction, expected) => {
    expect(stepReps(text, direction)).toBe(expected);
  });

  it("is at a limit at 0 and SET_REPS_MAX", () => {
    expect(repsAtLimit("0", "down")).toBe(true);
    expect(repsAtLimit("", "down")).toBe(true);
    expect(repsAtLimit("1", "down")).toBe(false);
    expect(repsAtLimit(String(SET_REPS_MAX), "up")).toBe(true);
  });
});
