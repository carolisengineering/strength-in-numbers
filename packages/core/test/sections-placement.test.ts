import { describe, expect, it } from "vitest";
import { insertIndexForSection, sectionForNewExercise } from "../src/index.js";

// Ranks: -1 = loose, otherwise the section's position. `ranks` are the OTHER exercises, in position order.
describe("09.4 AC24 — insertIndexForSection", () => {
  it.each([
    // Spec 09.4 §6.2 (sections W = 0, S = 1, C = 2)
    [[], 0, 0], // [·A] + empty W, move A into W → end (no sectioned exercise)
    [[0, 0, 1], 0, 2], // [a1, a2, b1] move ·X into W → after a2
    [[0, 1, -1], 2, 2], // [a1, b1, ·Y] + C, add X → before the loose tail
    [[1], -1, 0], // [a1(W), b1(S)] move a1 to "No section" → first sectioned index
    [[-1, 0, -1], -1, 1], // [·L, a1, b1, ·Y] move b1 to "No section" → after L
    [[1, -1, 1], 1, 3], // [a1(S), ·M, b2(S)] move X into S → after b2
    // more
    [[-1], 0, 1], // no sectioned exercise: end
    [[0, 1], -1, 0],
    [[-1, 0, 1, -1], -1, 1],
    [[3], 1, 0], // an empty earlier section: the start of the first sectioned run
    [[0, 3], 2, 1],
  ] as [number[], number, number][])("ranks %j, rank %i → %i", (ranks, rank, expected) => {
    expect(insertIndexForSection(ranks, rank)).toBe(expected);
  });
});

describe("09.4 AC24 — sectionForNewExercise", () => {
  const s = (position: number, addedInWorkout: boolean) => ({ id: `s${position}`, position, addedInWorkout });

  it("no sections → null", () => {
    expect(sectionForNewExercise([])).toBeNull();
  });
  it("the last section was copied from the routine → null", () => {
    expect(sectionForNewExercise([s(0, true), s(1, false)])).toBeNull();
  });
  it("the last section was added in the workout → that section", () => {
    expect(sectionForNewExercise([s(0, false), s(1, true)])).toEqual(s(1, true));
  });
  it("an added section that is not last → null", () => {
    expect(sectionForNewExercise([s(0, true), s(1, false), s(2, false)])).toBeNull();
  });
  it("input out of position order still picks the highest position", () => {
    expect(sectionForNewExercise([s(2, true), s(0, false), s(1, false)])).toEqual(s(2, true));
    expect(sectionForNewExercise([s(2, false), s(0, true)])).toBeNull();
  });
});
