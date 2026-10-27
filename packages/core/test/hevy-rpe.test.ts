import { describe, expect, it } from "vitest";
import { roundRpeForHevy, roundToTenth } from "../src/index.js";

describe("19.0 AC9 — RPE", () => {
  it.each([
    [5.9, null],
    [6, 6],
    [6.4, 6],
    [6.5, 7],
    [7.2, 7],
    [7.25, 7.5],
    [7.3, 7.5],
    [8.75, 9],
    [9.7, 9.5],
    [9.75, 10],
    [10, 10],
  ] as const)("%s → %s", (rpe, step) => {
    expect(roundRpeForHevy(rpe)).toBe(step);
  });
});

describe("19.0 AC6 — roundToTenth (half away from zero, with the floating guard)", () => {
  it.each([
    [135.0019, 135],
    [61.235, 61.2],
    [0.04, 0],
    [0.05, 0.1],
    [44.9999985, 45],
    [-0.05, -0.1],
  ])("%s → %s", (x, expected) => {
    expect(roundToTenth(x)).toBe(expected);
  });

  it("never returns -0", () => {
    expect(Object.is(roundToTenth(-0.01), 0)).toBe(true);
  });
});
