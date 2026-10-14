import { describe, expect, it } from "vitest";
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { supersetRows } from "./supersetRows";

const ex = (name: string, supersetGroup: number | null = null, sectionIndex: number | null = null): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  supersetGroup,
  sectionIndex,
});
const rowsOf = (exercises: ExerciseSpec[], sections = [{ name: "A" }, { name: "B" }]) => {
  const detail = makeWorkoutDetail({ sections, exercises });
  return { detail, rows: supersetRows(detail.exercises) };
};

describe("10.3 AC10 — runs break at section boundaries", () => {
  it("the same group number in two sections is two ungrouped slots, never one bracket", () => {
    const { detail, rows } = rowsOf([ex("a", 7, 0), ex("b", 7, 1)]);
    expect(rows.map((r) => r.bracket)).toEqual(["none", "none"]);
    expect(rows.map((r) => r.ordinal)).toEqual([null, null]);
    expect(rows.map((r) => r.label)).toEqual([null, null]);
    expect(rows.map((r) => r.linkedBelow)).toEqual([false, false]);
    expect(rows.map((r) => r.sectionId)).toEqual([detail.sections[0]!.id, detail.sections[1]!.id]);
  });

  it("[7,7 | 7,7] across A and B are two runs: first/last twice, ordinals 1,1,2,2", () => {
    const { rows } = rowsOf([ex("a", 7, 0), ex("b", 7, 0), ex("c", 7, 1), ex("d", 7, 1)]);
    expect(rows.map((r) => r.bracket)).toEqual(["first", "last", "first", "last"]);
    expect(rows.map((r) => r.ordinal)).toEqual([1, 1, 2, 2]);
    expect(rows.map((r) => r.label)).toEqual(["a, superset 1", "b, superset 1", "c, superset 2", "d, superset 2"]);
    expect(rows.map((r) => r.linkedBelow)).toEqual([true, false, true, false]);
  });

  it("a loose tail that reuses a section's group number is its own run", () => {
    const { rows } = rowsOf([ex("a", 7, 0), ex("b", 7, 0), ex("c", 7), ex("d", 7)]);
    expect(rows.map((r) => r.ordinal)).toEqual([1, 1, 2, 2]);
    expect(rows.map((r) => r.sectionId)).toEqual([expect.any(String), expect.any(String), null, null]);
  });

  it("with every sectionId null the output is today's: [7,7,null,3,3] → superset 1 and 2, ungrouped C", () => {
    const { rows } = rowsOf([ex("A", 7), ex("B", 7), ex("C"), ex("D", 3), ex("E", 3)], []);
    expect(rows.map((r) => r.label)).toEqual(["A, superset 1", "B, superset 1", null, "D, superset 2", "E, superset 2"]);
    expect(rows.map((r) => r.bracket)).toEqual(["first", "last", "none", "first", "last"]);
  });
});
