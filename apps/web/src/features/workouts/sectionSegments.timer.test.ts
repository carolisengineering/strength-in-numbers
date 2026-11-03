import type { SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { sectionSegments } from "./sectionSegments";
import { supersetRows } from "./supersetRows";

const ex = (name: string, sectionIndex: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex });
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const TIMES = [{ round: 1, seconds: 221 }];
const segmentsOf = (opts: WorkoutDetailOptions) => {
  const detail = makeWorkoutDetail(opts);
  return sectionSegments(supersetRows(detail.exercises), detail.sections);
};

describe("10.7 AC19 — segments carry timing", () => {
  it("a timed section's first segment carries its timer, result and round times", () => {
    const [segment] = segmentsOf({ sections: [{ name: "Main", timer: SET5, roundTimes: TIMES }], exercises: [ex("a", 0), ex("b", 0)] });
    expect(segment!.timing).toEqual({ timer: SET5, result: null, roundTimes: TIMES });
  });

  it("an untimed section, a loose segment and Other exercises carry none", () => {
    const segments = segmentsOf({ sections: [{ name: "Warm-up" }, { name: "Main", timer: SET5 }], exercises: [ex("loose"), ex("w", 0), ex("m", 1), ex("tail")] });
    expect(segments.map((s) => [s.heading, s.timing === null])).toEqual([
      [null, true],
      ["Warm-up", true],
      ["Main", false],
      ["Other exercises", true],
    ]);
  });

  it("a split timed section carries timing only on its first segment (Review Focus 4)", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0), ex("loose"), ex("c", 0)] });
    // The server keeps sections contiguous; a split is what 09.2 §6.5 allows, so build it by position.
    const exercises = detail.exercises.map((e) => (e.exerciseNameSnapshot === "loose" ? { ...e, position: 2 } : e));
    const segments = sectionSegments(supersetRows(exercises), detail.sections);
    expect(segments.map((s) => [s.heading, s.editable, s.timing !== null])).toEqual([
      ["Main", true, true],
      ["Other exercises", false, false],
      ["Main", false, false],
    ]);
  });

  it("an empty timed section still carries its timing", () => {
    const [segment] = segmentsOf({ sections: [{ name: "Main", timer: SET5 }], exercises: [] });
    expect(segment!.rows).toEqual([]);
    expect(segment!.timing?.timer).toEqual(SET5);
  });
});
