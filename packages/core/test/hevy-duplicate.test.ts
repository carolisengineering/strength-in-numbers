import { describe, expect, it } from "vitest";
import { isDuplicateWorkout, titleKey, type DuplicateSide } from "../src/index.js";

const START = "2026-10-01T10:00:00.000Z";
const side = (o: Partial<DuplicateSide> = {}): DuplicateSide => ({
  localDate: "2026-10-01",
  startedAt: START,
  title: "Push Day",
  rootIds: ["a", "b"],
  ...o,
});
const shifted = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

describe("19.1 AC10 — isDuplicateWorkout truth table", () => {
  it.each<[string, DuplicateSide, DuplicateSide, boolean]>([
    ["same day, same start, titles equal after trim, collapse and lowercase", side(), side({ title: " push  day " }), true],
    ["different local days", side(), side({ localDate: "2026-10-02" }), false],
    ["start Δ exactly 1 hour", side(), side({ startedAt: shifted(3_600_000) }), true],
    ["start Δ exactly −1 hour", side(), side({ startedAt: shifted(-3_600_000) }), true],
    ["start Δ 3 600 001 ms", side(), side({ startedAt: shifted(3_600_001) }), false],
    ["two different titles, identical roots", side({ title: "Push" }), side({ title: "Pull" }), false],
    ["one untitled, one shared of two", side({ title: null, rootIds: ["a", "b"] }), side({ rootIds: ["a", "c"] }), false],
    ["one untitled, two shared of three", side({ title: null, rootIds: ["a", "b", "c"] }), side({ rootIds: ["a", "b", "d"] }), true],
    ["both untitled, {a} and {a}", side({ title: null, rootIds: ["a"] }), side({ title: null, rootIds: ["a"] }), true],
    ["untitled, {} and {a}", side({ title: null, rootIds: [] }), side({ title: null, rootIds: ["a"] }), false],
    ["untitled, {} and {}", side({ title: null, rootIds: [] }), side({ title: null, rootIds: [] }), false],
    ["a title of only spaces counts as untitled", side({ title: "   ", rootIds: ["a"] }), side({ title: "Push", rootIds: ["a"] }), true],
    ["repeated roots count once", side({ title: null, rootIds: ["a", "a", "a"] }), side({ title: null, rootIds: ["a", "b"] }), false],
    ["one side larger: 2 shared of max 4 is not a match", side({ title: null, rootIds: ["a", "b"] }), side({ rootIds: ["a", "b", "c", "d"] }), false],
    ["one side larger: 3 shared of max 4 is a match", side({ title: null, rootIds: ["a", "b", "c"] }), side({ rootIds: ["a", "b", "c", "d"] }), true],
  ])("%s", (_label, h, s, expected) => {
    expect(isDuplicateWorkout(h, s)).toBe(expected);
    expect(isDuplicateWorkout(s, h)).toBe(expected);
  });

  it("titleKey trims, collapses inner whitespace and lowercases; blank is null", () => {
    expect(titleKey("  Push\t\n Day ")).toBe("push day");
    expect(titleKey("   ")).toBeNull();
    expect(titleKey(null)).toBeNull();
  });
});
