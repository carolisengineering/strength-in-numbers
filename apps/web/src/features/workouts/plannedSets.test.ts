import { describe, expect, it } from "vitest";
import type { PlannedSet, SetType } from "@sin/core";
import { nextPlanned, setLabel } from "./plannedSets";

const row = (o: Partial<PlannedSet> = {}): PlannedSet => ({ setType: "working", repsLow: 8, repsHigh: 8, weight: 80, weightUnit: "kg", ...o });
const PLAN = [row({ setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60 }), row(), row({ repsLow: 6, repsHigh: 6, weight: 100 })];

describe("10.2 AC20 — nextPlanned", () => {
  it.each([
    [0, 0], [1, 1], [2, 2],
  ])("with %i logged, the next planned row is index %i", (logged, index) => {
    const next = nextPlanned(PLAN, logged);
    expect(next).toEqual({ kind: "planned", row: PLAN[index], index, total: 3 });
  });
  it.each([3, 4, 5, 20])("with %i logged the plan is used up → extra", (logged) => {
    expect(nextPlanned(PLAN, logged)).toEqual({ kind: "extra" });
  });
  it.each([0, 1, 7])("no plan → none, whatever the count (%i)", (logged) => {
    expect(nextPlanned([], logged)).toEqual({ kind: "none" });
  });
  it("the index is the logged COUNT, never a set number: a gap in set numbers (a deleted set) does not skip a row", () => {
    // setNumber is append-only, so [1, 3] is two sets logged: the next planned row is index 2, not 3.
    expect(nextPlanned(PLAN, [1, 3].length)).toMatchObject({ kind: "planned", index: 2 });
  });
});

// Since Spec 17.7 the label takes the draft's type; an untouched planned draft carries the row's own type.
describe("10.2 AC21 — setLabel", () => {
  it.each([
    [0, "Set 1 of 3 · Warm-up"],
    [1, "Set 2 of 3"],
    [2, "Set 3 of 3"],
    [3, "Extra set"],
    [9, "Extra set"],
  ])("%i logged → %s", (logged, label) => {
    expect(setLabel(PLAN, logged, PLAN[logged]?.setType ?? "working")).toBe(label);
  });
  it("shows the 05.1 label for every non-working type", () => {
    expect(setLabel([row({ setType: "drop" })], 0, "drop")).toBe("Set 1 of 1 · Drop");
    expect(setLabel([row({ setType: "failure" })], 0, "failure")).toBe("Set 1 of 1 · Failure");
    expect(setLabel([row({ setType: "warmup" })], 0, "warmup")).toBe("Set 1 of 1 · Warm-up");
  });
  it("with no plan it is exactly today's 'Set {n + 1}'", () => {
    expect(setLabel([], 0, "working")).toBe("Set 1");
    expect(setLabel([], 4, "working")).toBe("Set 5");
  });
});

describe("17.7 AC17 — the label names the draft's set type, not the plan row's", () => {
  const four = [row({ setType: "warmup" }), row(), row(), row()];
  it.each<[string, readonly PlannedSet[], number, SetType, string]>([
    ["4 rows, row 2 working, a warm-up draft", four, 1, "warmup", "Set 2 of 4 · Warm-up"],
    ["4 rows, row 2 working, a working draft", four, 1, "working", "Set 2 of 4"],
    ["4 rows, row 1 a warm-up, turned to working", four, 0, "working", "Set 1 of 4"],
    ["1 row, a failure draft", [row()], 0, "failure", "Set 1 of 1 · Failure"],
    ["no plan, a warm-up draft", [], 2, "warmup", "Set 3 · Warm-up"],
    ["no plan, a working draft", [], 2, "working", "Set 3"],
    ["plan used up, a drop draft", [row()], 1, "drop", "Extra set · Drop"],
    ["plan used up, a working draft", [row()], 1, "working", "Extra set"],
  ])("%s", (_case, plan, logged, type, label) => {
    expect(setLabel(plan, logged, type)).toBe(label);
  });
});
