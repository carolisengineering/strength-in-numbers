import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { describe, expect, it } from "vitest";
import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../../test/workoutFixtures";
import { timedRegroupTargets } from "./timedGrouping";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const ex = (name: string, sectionIndex: number | null, supersetGroup: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, supersetGroup });

const build = (opts: WorkoutDetailOptions) => makeWorkoutDetail(opts);
const idOf = (d: WorkoutDetail, name: string) => d.exercises.find((e) => e.exerciseNameSnapshot === name)!.id;
const main = (d: WorkoutDetail, name = "Main") => d.sections.find((s) => s.name === name)!.id;
const ranges = (targets: ReturnType<typeof timedRegroupTargets>) => targets.map((t) => ({ start: t.start, from: t.from, to: t.to, n: t.slots.length }));

describe("10.7 AC22 — what a workout groups (pure)", () => {
  describe("fill", () => {
    it("three loose exercises in a timed section give one target over all three", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0), ex("c", 0)] });
      expect(ranges(timedRegroupTargets(d, main(d), "fill"))).toEqual([{ start: 0, from: 0, to: 2, n: 3 }]);
    });

    it("Second Shift — two supersets of two — gives nothing", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0, 1), ex("b", 0, 1), ex("c", 0, 2), ex("d", 0, 2)] });
      expect(timedRegroupTargets(d, main(d), "fill")).toEqual([]);
    });

    it("a superset of 3 plus one loose gives nothing", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0, 1), ex("b", 0, 1), ex("c", 0, 1), ex("d", 0)] });
      expect(timedRegroupTargets(d, main(d), "fill")).toEqual([]);
    });

    it("slots carry the ids and groups, in order", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0)] });
      expect(timedRegroupTargets(d, main(d), "fill")[0]!.slots).toEqual([
        { id: idOf(d, "a"), group: null },
        { id: idOf(d, "b"), group: null },
      ]);
    });
  });

  describe("join", () => {
    it("a superset of 3 plus the new one gives a target over all 4", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0, 1), ex("b", 0, 1), ex("c", 0, 1), ex("new", 0)] });
      expect(ranges(timedRegroupTargets(d, main(d), { join: idOf(d, "new") }))).toEqual([{ start: 0, from: 0, to: 3, n: 4 }]);
    });

    it("two supersets plus the new one gives nothing", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0, 1), ex("b", 0, 1), ex("c", 0, 2), ex("d", 0, 2), ex("new", 0)] });
      expect(timedRegroupTargets(d, main(d), { join: idOf(d, "new") })).toEqual([]);
    });

    it("one other loose exercise plus the new one gives a target over 2", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("new", 0)] });
      expect(ranges(timedRegroupTargets(d, main(d), { join: idOf(d, "new") }))).toEqual([{ start: 0, from: 0, to: 1, n: 2 }]);
    });

    it("a join whose exercise isn't in the section does nothing", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0), ex("loose", null)] });
      expect(timedRegroupTargets(d, main(d), { join: idOf(d, "loose") })).toEqual([]);
      expect(timedRegroupTargets(d, main(d), { join: "00000000-0000-4000-8000-0000000000ff" })).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("an untimed section gives nothing", () => {
      const d = build({ sections: [{ name: "Main" }], exercises: [ex("a", 0), ex("b", 0)] });
      expect(timedRegroupTargets(d, main(d), "fill")).toEqual([]);
    });

    it("a missing section gives nothing", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0)] });
      expect(timedRegroupTargets(d, "00000000-0000-4000-8000-0000000000ee", "fill")).toEqual([]);
    });

    it("a one-row segment gives no target", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0)] });
      expect(timedRegroupTargets(d, main(d), "fill")).toEqual([]);
    });

    it("start is the segment's start in the workout", () => {
      const d = build({ sections: [{ name: "Warm-up" }, { name: "Main", timer: SET5 }], exercises: [ex("w1", 0), ex("w2", 0), ex("a", 1), ex("b", 1)] });
      expect(ranges(timedRegroupTargets(d, main(d), "fill"))).toEqual([{ start: 2, from: 0, to: 1, n: 2 }]);
    });

    it("a split section is decided per segment (Review Focus 4)", () => {
      const d = build({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0), ex("b", 0), ex("loose", null), ex("c", 0), ex("e", 0, 1), ex("f", 0, 1)] });
      // Put the loose exercise between the two runs of Main (09.2 §6.5 allows a split).
      const order = ["a", "b", "loose", "c", "e", "f"];
      const split = { ...d, exercises: d.exercises.map((e) => ({ ...e, position: order.indexOf(e.exerciseNameSnapshot) })) };
      // First segment (a, b): nothing grouped → fill. Second (c, e, f): a superset exists → nothing.
      expect(ranges(timedRegroupTargets(split, main(d), "fill"))).toEqual([{ start: 0, from: 0, to: 1, n: 2 }]);
      // A join of c looks only at c's segment: the others there are exactly one superset (e, f) → all three.
      expect(ranges(timedRegroupTargets(split, main(d), { join: idOf(d, "c") }))).toEqual([{ start: 3, from: 0, to: 2, n: 3 }]);
    });
  });
});
