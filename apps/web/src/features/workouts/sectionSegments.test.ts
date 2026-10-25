import { describe, expect, it } from "vitest";
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { OTHER_EXERCISES_HEADING, sectionSegments } from "./sectionSegments";
import { supersetRows } from "./supersetRows";

type Sec = { name: string; notes?: string | null };
const ex = (name: string, sectionIndex: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex });

/** "Warm-up*(a,b)" = heading Warm-up with its note, rows a and b; "∅(…)" = no heading. */
function sig(exercises: ExerciseSpec[], sections: Sec[]) {
  const detail = makeWorkoutDetail({ sections, exercises });
  const segments = sectionSegments(supersetRows(detail.exercises), detail.sections);
  return {
    text: segments.map((s) => `${s.heading ?? "∅"}${s.notes ? "*" : ""}(${s.rows.map((r) => r.exercise.exerciseNameSnapshot).join(",")})`).join(" "),
    starts: segments.map((s) => s.start),
  };
}
const A = { name: "A", notes: "note A" };

describe("10.3 AC11 — sectionSegments", () => {
  it.each([
    ["no sections: one headingless segment of all rows", [ex("a"), ex("b")], [], "∅(a,b)"],
    ["no sections and no rows: one empty headingless segment", [], [], "∅()"],
    ["loose first has no heading, then the section", [ex("a"), ex("b", 0), ex("c", 0)], [{ name: "M" }], "∅(a) M(b,c)"],
    ["a loose tail after a section is 'Other exercises'", [ex("a", 0), ex("b")], [{ name: "M" }], "M(a) Other exercises(b)"],
    ["an empty first section shows its heading and note", [ex("a", 1)], [A, { name: "B" }], "A*() B(a)"],
    ["an empty middle section sits before the next section's rows", [ex("a", 0), ex("c", 2)], [{ name: "A" }, { name: "B" }, { name: "C" }], "A(a) B() C(c)"],
    ["an empty last section goes last", [ex("a", 0)], [{ name: "A" }, { name: "B" }], "A(a) B()"],
    ["an empty section sits before the trailing loose segment", [ex("a", 0), ex("x")], [{ name: "A" }, { name: "B" }], "A(a) B() Other exercises(x)"],
    ["a leading loose segment stays first and headingless; empty sections follow it", [ex("a"), ex("b")], [{ name: "A" }], "∅(a,b) A()"],
    ["a section split into two runs shows its note only under the first; the loose gap is 'Other exercises'", [ex("a", 0), ex("b"), ex("c", 0)], [A], "A*(a) Other exercises(b) A(c)"],
    ["only empty sections", [], [A, { name: "B" }], "A*() B()"],
  ])("%s", (_name, exercises, sections, expected) => {
    expect(sig(exercises, sections).text).toBe(expected);
  });

  it("start is the index of each segment's first row in the position-ordered list", () => {
    expect(sig([ex("a"), ex("b", 0), ex("c", 0), ex("d")], [{ name: "M" }]).starts).toEqual([0, 1, 3]);
  });

  it("an exercise naming a section the workout does not have is loose", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "M" }], exercises: [ex("a", 0), ex("b", 0)] });
    const segments = sectionSegments(supersetRows(detail.exercises), []);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.heading).toBeNull();
    expect(segments[0]!.rows).toHaveLength(2);
  });
});

describe("10.3 AC11 — segment keys are stable when an earlier run disappears (final review)", () => {
  const keys = (exercises: ExerciseSpec[], sections: Sec[]) => {
    const detail = makeWorkoutDetail({ sections, exercises });
    return sectionSegments(supersetRows(detail.exercises), detail.sections).map((s) => [s.heading, s.key]);
  };
  it("removing the only loose-first exercise does not change the other segments' keys", () => {
    // One detail, so the section ids are the same on both sides; the second side just drops the loose exercise.
    const detail = makeWorkoutDetail({ sections: [{ name: "A" }, { name: "B" }], exercises: [ex("x"), ex("a", 0), ex("b", 1)] });
    const keyed = (exercises: typeof detail.exercises) =>
      sectionSegments(supersetRows(exercises), detail.sections).filter((s) => s.heading !== null).map((s) => [s.heading, s.key]);
    const without = detail.exercises.filter((e) => e.exerciseNameSnapshot !== "x");
    expect(keyed(without)).toEqual(keyed(detail.exercises));
  });
  it("keys are unique within one render, including a split section and several loose runs", () => {
    const all = keys([ex("x"), ex("a", 0), ex("y"), ex("c", 0), ex("z")], [{ name: "A" }]).map(([, k]) => k);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("#156 — adding a section keeps the trailing 'Other exercises' key", () => {
  it("a new (empty, last) section lands before the loose tail; the tail's key does not change", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "A" }, { name: "New" }], exercises: [ex("a", 0), ex("x"), ex("y")] });
    const tailKey = (sections: typeof detail.sections) => sectionSegments(supersetRows(detail.exercises), sections).at(-1)!;
    const before = tailKey(detail.sections.slice(0, 1));
    const after = tailKey(detail.sections);
    expect([before.heading, after.heading]).toEqual([OTHER_EXERCISES_HEADING, OTHER_EXERCISES_HEADING]);
    expect(after.key).toBe(before.key);
  });
  it("removing the section after a loose run (it becomes the tail) keeps that run's key (code review)", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "A" }, { name: "B" }], exercises: [ex("a", 0), ex("x"), ex("b", 1)] });
    const keyOfX = (exercises: typeof detail.exercises, sections: typeof detail.sections) =>
      sectionSegments(supersetRows(exercises), sections).find((s) => s.rows.some((r) => r.exercise.exerciseNameSnapshot === "x"))!.key;
    const withoutB = detail.exercises.map((e) => (e.exerciseNameSnapshot === "b" ? { ...e, sectionId: null } : e));
    expect(keyOfX(withoutB, detail.sections.slice(0, 1))).toBe(keyOfX(detail.exercises, detail.sections));
  });
  it("filling the new section from elsewhere keeps the tail's key", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "A" }, { name: "New" }], exercises: [ex("a", 0), ex("x"), ex("y")] });
    const tail = (exercises: typeof detail.exercises) => sectionSegments(supersetRows(exercises), detail.sections).at(-1)!.key;
    const newId = detail.sections[1]!.id;
    const aInNew = detail.exercises.map((e) => (e.exerciseNameSnapshot === "a" ? { ...e, sectionId: newId } : e));
    expect(tail(aInNew)).toBe(tail(detail.exercises));
  });
});

describe("10.6 AC1 — sectionSegments carries sectionId and editable", () => {
  const segs = (exercises: ExerciseSpec[], sections: Sec[]) => {
    const detail = makeWorkoutDetail({ sections, exercises });
    return { detail, segments: sectionSegments(supersetRows(detail.exercises), detail.sections) };
  };

  it("a section split in two: the first segment is editable, the second is not, same sectionId", () => {
    const { detail, segments } = segs([ex("a", 0), ex("b"), ex("c", 0)], [A]);
    const id = detail.sections[0]!.id;
    expect(segments.map((s) => [s.sectionId, s.editable])).toEqual([
      [id, true],
      [null, false],
      [id, false],
    ]);
  });

  it("a loose head and an 'Other exercises' tail carry no sectionId and are not editable", () => {
    const { detail, segments } = segs([ex("a"), ex("b", 0), ex("c")], [{ name: "M" }]);
    expect(segments.map((s) => [s.heading, s.sectionId, s.editable])).toEqual([
      [null, null, false],
      ["M", detail.sections[0]!.id, true],
      ["Other exercises", null, false],
    ]);
  });

  it("an empty section is editable", () => {
    const { detail, segments } = segs([ex("a", 0)], [{ name: "A" }, { name: "B" }]);
    expect(segments[1]).toMatchObject({ heading: "B", sectionId: detail.sections[1]!.id, editable: true, rows: [] });
  });

  it("no sections: one segment with no sectionId", () => {
    const { segments } = segs([ex("a")], []);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ sectionId: null, editable: false });
  });
});
