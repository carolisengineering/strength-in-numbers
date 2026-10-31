import { describe, expect, it } from "vitest";
import { buildImportPlan } from "../src/importPlan.js";
import { readWorkoutText, type ReadResult } from "../src/workoutText.js";

const read = readWorkoutText(["Strength", "3 Rounds", "10 Squats", "10 Burpees", "Conditioning", "2 Rounds", "5 Rows", "5 Pushups"].join("\n"));

describe("Minor 220 — the plan does not trust its input's order", () => {
  it("the reader's own output is section-ordered (the fixture of this test)", () => {
    expect(read.items.map((i) => i.section)).toEqual([0, 0, 1, 1]);
  });

  it("a hand-built read with sections out of order still plans loose first, then section by section", () => {
    const shuffled: ReadResult = { ...read, items: [...read.items].reverse() };
    const plan = buildImportPlan(shuffled, () => "weight_reps");
    expect(plan.items.map((i) => i.section ?? -1)).toEqual([0, 0, 1, 1]);
    const groups = plan.items.map((i) => i.supersetGroup).filter((g) => g !== null);
    expect(groups).toEqual([...groups].sort((a, b) => a! - b!));
    expect(groups[0]).toBe(1);
  });

  it("an in-order read plans exactly as before", () => {
    const plan = buildImportPlan(read, () => "weight_reps");
    expect(plan.items.map((i) => [i.name, i.section, i.supersetGroup])).toEqual([
      ["Squats", 0, 1],
      ["Burpees", 0, 1],
      ["Rows", 1, 2],
      ["Pushups", 1, 2],
    ]);
  });
});
