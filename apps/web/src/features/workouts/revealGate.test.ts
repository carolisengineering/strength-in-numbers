import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { revealStep } from "./revealGate";

describe("minor 417 — the reveal after a log is dropped once the lifter chose another card", () => {
  it("drops the reveal when the lifter has chosen since the log", () => {
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 3, exercises: [], choice: 5 })).toBe("drop");
  });

  it("drops it while the count is still short, too: a tap elsewhere ends the wait", () => {
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 2, exercises: [], choice: 5 })).toBe("drop");
  });

  it("Review Focus 1: an advance reveals the panel once the count is listed", () => {
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 2, exercises: [], choice: 4 })).toBe("wait");
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 3, exercises: [], choice: 4 })).toBe("reveal");
  });

  it("an Undo's gate waits until the undone row has left the list (minor 428, unchanged)", () => {
    const set = makeSet();
    const listed = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [set] }] }).exercises;
    const gone = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [] }] }).exercises;
    expect(revealStep({ kind: "gone", set, choice: 4 }, { totalSets: 1, exercises: listed, choice: 4 })).toBe("wait");
    expect(revealStep({ kind: "gone", set, choice: 4 }, { totalSets: 0, exercises: gone, choice: 4 })).toBe("reveal");
  });
});

describe("minor 710 — with no choice since the log, the gate waits and then reveals, whatever is current", () => {
  it("waits while the count is short and reveals once it is listed", () => {
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 2, exercises: [], choice: 4 })).toBe("wait");
    expect(revealStep({ kind: "count", sets: 3, choice: 4 }, { totalSets: 3, exercises: [], choice: 4 })).toBe("reveal");
  });
});

describe("minor 713 — an Undo's gate drops when the lifter chose another card", () => {
  it("drops while the undone row is still listed", () => {
    const set = makeSet();
    const listed = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [set] }] }).exercises;
    expect(revealStep({ kind: "gone", set, choice: 4 }, { totalSets: 1, exercises: listed, choice: 5 })).toBe("drop");
  });
});
