import { describe, expect, it } from "vitest";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { findIncompleteWorkingSets } from "./incomplete";

describe("AC9 — findIncompleteWorkingSets", () => {
  it("flags working sets with a null required measure, never reps: 0, never non-working types", () => {
    const failedAttempt = makeSet({ reps: 0, setType: "working" }); // legitimate: reps 0 is not null
    const missingWeight = makeSet({ weight: null, weightUnit: null, setNumber: 2, isComplete: false });
    const warmupMissing = makeSet({ weight: null, weightUnit: null, setType: "warmup", setNumber: 3 });
    const dropMissing = makeSet({ reps: null, setType: "drop", setNumber: 4 });
    const failureMissing = makeSet({ reps: null, setType: "failure", setNumber: 5 });
    const timedMissing = makeSet({
      reps: null,
      weight: null,
      weightUnit: null,
      durationS: null,
      isComplete: false,
    });
    const timedOk = makeSet({ reps: null, weight: null, weightUnit: null, durationS: 0 });

    const detail = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", sets: [failedAttempt, missingWeight, warmupMissing, dropMissing, failureMissing] },
        { modality: "duration", sets: [timedMissing, timedOk] },
      ],
    });

    expect(findIncompleteWorkingSets(detail)).toEqual([missingWeight.id, timedMissing.id]);
  });

  it("an empty workout has nothing to flag", () => {
    expect(findIncompleteWorkingSets(makeWorkoutDetail())).toEqual([]);
  });

  it("checks each exercise against its own modality snapshot", () => {
    // reps present but weight null: incomplete for weight_reps, complete for bodyweight_reps
    const partial = { weight: null, weightUnit: null };
    const weighted = makeSet(partial);
    const bodyweight = makeSet(partial);
    const detail = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", sets: [weighted] },
        { modality: "bodyweight_reps", sets: [bodyweight] },
      ],
    });
    expect(findIncompleteWorkingSets(detail)).toEqual([weighted.id]);
  });
});
