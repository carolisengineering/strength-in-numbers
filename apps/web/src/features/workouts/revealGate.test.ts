import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { revealStep } from "./revealGate";

describe("minor 417 — the reveal after a log belongs to the exercise it was for", () => {
  it("drops the reveal when current is no longer the expected exercise", () => {
    expect(revealStep({ kind: "count", sets: 3, id: "B" }, { totalSets: 3, exercises: [], currentId: "C" })).toBe("drop");
  });

  it("drops it while the count is still short, too: a tap elsewhere ends the wait", () => {
    expect(revealStep({ kind: "count", sets: 3, id: "B" }, { totalSets: 2, exercises: [], currentId: "C" })).toBe("drop");
    expect(revealStep({ kind: "count", sets: 3, id: "B" }, { totalSets: 3, exercises: [], currentId: null })).toBe("drop");
  });

  it("Review Focus 1: an advance to B reveals B's panel once the count is listed", () => {
    expect(revealStep({ kind: "count", sets: 3, id: "B" }, { totalSets: 2, exercises: [], currentId: "B" })).toBe("wait");
    expect(revealStep({ kind: "count", sets: 3, id: "B" }, { totalSets: 3, exercises: [], currentId: "B" })).toBe("reveal");
  });

  it("an Undo's gate waits until the undone row has left the list (minor 428, unchanged)", () => {
    const set = makeSet();
    const listed = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [set] }] }).exercises;
    const gone = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [] }] }).exercises;
    expect(revealStep({ kind: "gone", set }, { totalSets: 1, exercises: listed, currentId: "A" })).toBe("wait");
    expect(revealStep({ kind: "gone", set }, { totalSets: 0, exercises: gone, currentId: "A" })).toBe("reveal");
  });
});
