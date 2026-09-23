import { describe, expect, it } from "vitest";
import { WORKOUT_SOURCE_VALUES } from "../src/index.js";

describe("AC19 — WORKOUT_SOURCE_VALUES", () => {
  it("is frozen and contains exactly 'manual'", () => {
    expect(Object.isFrozen(WORKOUT_SOURCE_VALUES)).toBe(true);
    expect(WORKOUT_SOURCE_VALUES).toEqual(["manual"]);
  });
});
