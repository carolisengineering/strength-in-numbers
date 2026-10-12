import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX, PlannedSetSchema, RoutineWriteSchema, SET_WEIGHT_MAX } from "../src/index.js";

const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000010";
const doc = (item: Record<string, unknown>) => ({ name: "Push A", items: [{ exerciseId: EX, ...item }] });
const issues = (item: Record<string, unknown>) => {
  const r = RoutineWriteSchema.safeParse(doc(item));
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("AC1 (core) — PlannedSet has exactly five keys, no id or position", () => {
  it("shape", () => {
    expect(Object.keys(PlannedSetSchema.shape).sort()).toEqual(["repsHigh", "repsLow", "setType", "weight", "weightUnit"]);
  });
});

describe("AC4 — row validation matrix", () => {
  it.each([
    [{ repsLow: 0, repsHigh: 5 }, "items.0.sets.0.repsLow"],
    [{ repsLow: 5, repsHigh: 101 }, "items.0.sets.0.repsHigh"],
    [{ repsLow: 5 }, "items.0.sets.0.repsHigh"],
    [{ repsHigh: 5 }, "items.0.sets.0.repsLow"],
    [{ repsLow: 9, repsHigh: 8 }, "items.0.sets.0.repsLow"],
    [{ weight: -0.001, weightUnit: "kg" }, "items.0.sets.0.weight"],
    [{ weight: SET_WEIGHT_MAX + 0.001, weightUnit: "kg" }, "items.0.sets.0.weight"],
    [{ weight: 100 }, "items.0.sets.0.weightUnit"],
    [{ weightUnit: "kg" }, "items.0.sets.0.weight"],
    [{ setType: "amrap" }, "items.0.sets.0.setType"],
    [{ position: 0 }, "items.0.sets.0"],
  ])("%j → 422 at %s", (bad, path) => {
    expect(issues({ sets: [bad] })).toContain(path);
  });

  it.each([
    [{ repsLow: 1, repsHigh: 1 }],
    [{ repsLow: 100, repsHigh: 100 }],
    [{ weight: 0, weightUnit: "kg" }],
    [{ weight: SET_WEIGHT_MAX, weightUnit: "lb" }],
    [{ setType: "warmup" }],
    [{}],
  ])("%j is valid", (good) => {
    expect(issues({ sets: [good] })).toEqual([]);
  });

  it(`more than ${PLANNED_SETS_PER_ITEM_MAX} rows → 422 at items.0.sets; exactly ${PLANNED_SETS_PER_ITEM_MAX} is fine`, () => {
    expect(issues({ sets: Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, () => ({})) })).toEqual([]);
    expect(issues({ sets: Array.from({ length: PLANNED_SETS_PER_ITEM_MAX + 1 }, () => ({})) })).toContain("items.0.sets");
  });

  it("sets: null → 422; sets: [] is a valid 'no plan'", () => {
    expect(issues({ sets: null })).toContain("items.0.sets");
    expect(issues({ sets: [] })).toEqual([]);
  });

  it("collects every row issue in one result", () => {
    const paths = issues({ sets: [{ repsLow: 5 }, { weight: 10 }] });
    expect(paths).toEqual(expect.arrayContaining(["items.0.sets.0.repsHigh", "items.0.sets.1.weightUnit"]));
  });
});

describe("AC7 — one form per item, by key presence (Review Focus 5)", () => {
  it.each(["targetSets", "targetRepsLow", "targetRepsHigh"])("sets + %s (even null) → 422 at items.0.sets", (key) => {
    expect(issues({ sets: [], [key]: null })).toContain("items.0.sets");
  });
  it("sets alone passes; the legacy all-null body (no sets) passes", () => {
    expect(issues({ sets: [{ repsLow: 5, repsHigh: 5 }] })).toEqual([]);
    expect(issues({ targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null })).toEqual([]);
  });
  it("targetRpe / restSeconds / notes may accompany sets", () => {
    expect(issues({ sets: [], targetRpe: 8.5, restSeconds: 90, notes: "x" })).toEqual([]);
  });
});
