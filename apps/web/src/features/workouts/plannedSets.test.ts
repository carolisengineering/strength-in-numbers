import { describe, expect, it } from "vitest";
import type { PlannedSet } from "@sin/core";
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

describe("10.2 AC21 — setLabel", () => {
  it.each([
    [0, "Set 1 of 3 · Warm-up"],
    [1, "Set 2 of 3"],
    [2, "Set 3 of 3"],
    [3, "Extra set"],
    [9, "Extra set"],
  ])("%i logged → %s", (logged, label) => {
    expect(setLabel(PLAN, logged)).toBe(label);
  });
  it("shows the 05.1 label for every non-working type", () => {
    expect(setLabel([row({ setType: "drop" })], 0)).toBe("Set 1 of 1 · Drop");
    expect(setLabel([row({ setType: "failure" })], 0)).toBe("Set 1 of 1 · Failure");
    expect(setLabel([row({ setType: "warmup" })], 0)).toBe("Set 1 of 1 · Warm-up");
  });
  it("with no plan it is exactly today's 'Set {n + 1}'", () => {
    expect(setLabel([], 0)).toBe("Set 1");
    expect(setLabel([], 4)).toBe("Set 5");
  });
});
