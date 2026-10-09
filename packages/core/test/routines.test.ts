import { describe, expect, it } from "vitest";
import { normalizeSupersetGroups, rpeToTenths, tenthsToRpe } from "../src/routines.js";

describe("AC12 — normalizeSupersetGroups renumbers by first appearance", () => {
  it("[7, null, 3, 7, 3] → [1, null, 2, 1, 2]", () => {
    expect(normalizeSupersetGroups([7, null, 3, 7, 3])).toEqual([1, null, 2, 1, 2]);
  });
  it("an already-dense list is unchanged", () => {
    expect(normalizeSupersetGroups([1, 1, 2, 2])).toEqual([1, 1, 2, 2]);
  });
  it("all-null stays all-null; empty stays empty", () => {
    expect(normalizeSupersetGroups([null, null])).toEqual([null, null]);
    expect(normalizeSupersetGroups([])).toEqual([]);
  });
  it("non-adjacent members keep one group id", () => {
    expect(normalizeSupersetGroups([5, null, 9, null, 5])).toEqual([1, null, 2, null, 1]);
  });
  it("does not mutate its input", () => {
    const input = [7, null, 3];
    normalizeSupersetGroups(input);
    expect(input).toEqual([7, null, 3]);
  });
});

describe("AC10 — RPE tenths round-trip", () => {
  it("every half step 6 … 10 survives rpeToTenths → tenthsToRpe", () => {
    for (let x = 6; x <= 10; x += 0.5) {
      const tenths = rpeToTenths(x);
      expect(Number.isInteger(tenths)).toBe(true);
      expect(tenths % 5).toBe(0);
      expect(tenthsToRpe(tenths)).toBe(x);
    }
  });
  it("8.5 ↔ 85, 6 ↔ 60, 10 ↔ 100", () => {
    expect(rpeToTenths(8.5)).toBe(85);
    expect(rpeToTenths(6)).toBe(60);
    expect(rpeToTenths(10)).toBe(100);
    expect(tenthsToRpe(85)).toBe(8.5);
  });
});
