import { describe, expect, it } from "vitest";
import { groupBySection, sectionOrderViolations, sectionSpanViolations } from "../src/index.js";

describe("AC25 — sectionOrderViolations (loose first, then sections in order, each one run)", () => {
  it.each([
    [[], []],
    [[null, null], []],
    [[null, 0, 0, 1], []], // loose first, then two sections
    [[0, 1, 2], []], // an unused/empty section is just a skipped index
    [[0, null], [1]], // loose after a sectioned item
    [[null, 0, null], [2]],
    [[1, 0], [1]], // earlier section after a later one
    [[0, 1, 0], [2]], // a section split in two runs
    [[0, 1, 0, 1], [2]],
    [[2, 0, 1], [1, 2]],
  ] as [(number | null)[], number[]][])("%j → %j", (refs, expected) => {
    expect(sectionOrderViolations(refs)).toEqual(expected);
  });
});

describe("AC25 — sectionSpanViolations (a superset stays inside one section; loose is its own section)", () => {
  it.each([
    [[1, 1], [0, 0], []],
    [[1, 1], [0, 1], [1]], // across two sections
    [[1, null, 1], [null, null, 0], [2]], // loose and a section
    [[1, 1, 1], [0, 0, 1], [2]],
    [[null, null], [0, 1], []], // no group, nothing to span
    [[1], [0], []], // a group of one cannot span
    [[1, 2, 1, 2], [0, 0, 1, 1], [2, 3]], // a label reused in two sections: every later offender
  ] as [(number | null)[], (number | null)[], number[]][])("groups %j refs %j → %j", (groups, refs, expected) => {
    expect(sectionSpanViolations(groups, refs)).toEqual(expected);
  });
});

describe("AC25 — groupBySection yields maximal runs and never throws", () => {
  const of = (xs: (string | null)[]) => groupBySection(xs.map((s, i) => ({ i, s })), (x) => x.s);
  it("contiguous", () => {
    expect(of([null, "a", "a", "b"]).map((g) => [g.sectionId, g.items.map((x) => x.i)])).toEqual([
      [null, [0]], ["a", [1, 2]], ["b", [3]],
    ]);
  });
  it("a split section is two runs, in order", () => {
    expect(of(["a", "b", "a"]).map((g) => g.sectionId)).toEqual(["a", "b", "a"]);
  });
  it("empty input → []", () => {
    expect(of([])).toEqual([]);
  });
  it("all loose → one run with sectionId null", () => {
    expect(of([null, null]).map((g) => [g.sectionId, g.items.length])).toEqual([[null, 2]]);
  });
});
