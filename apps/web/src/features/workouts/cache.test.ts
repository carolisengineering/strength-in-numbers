import { describe, expect, it } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { withSetRemoved, withSetUpserted } from "./cache";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fixture(): WorkoutDetail {
  const detail = makeWorkoutDetail({
    exercises: [
      { modality: "weight_reps", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 3 })] },
      { modality: "bodyweight_reps", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null })] },
    ],
  });
  return deepFreeze(detail);
}

describe("AC4 — cache transformers are pure and surgical", () => {
  it("withSetUpserted replaces a set with the same id, keeping setNumber order", () => {
    const detail = fixture();
    const first = detail.exercises[0]!;
    const changed = { ...first.sets[0]!, reps: 10 };
    const next = withSetUpserted(detail, changed);
    expect(next.exercises[0]!.sets.map((s) => s.id)).toEqual(first.sets.map((s) => s.id));
    expect(next.exercises[0]!.sets[0]!.reps).toBe(10);
  });

  it("withSetUpserted inserts a new set at its setNumber position", () => {
    const detail = fixture();
    const exercise = detail.exercises[0]!;
    const added = makeSet({ workoutExerciseId: exercise.id, setNumber: 2 });
    const next = withSetUpserted(detail, added);
    expect(next.exercises[0]!.sets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it("an upsert into an unknown exercise returns the same detail", () => {
    const detail = fixture();
    expect(withSetUpserted(detail, makeSet({ workoutExerciseId: "30000000-0000-4000-8000-000000000009" }))).toBe(
      detail,
    );
  });

  it("withSetRemoved drops the set", () => {
    const detail = fixture();
    const target = detail.exercises[0]!.sets[1]!;
    const next = withSetRemoved(detail, target.id);
    expect(next.exercises[0]!.sets.map((s) => s.id)).not.toContain(target.id);
    expect(next.exercises[0]!.sets).toHaveLength(1);
  });

  it("removing an unknown set returns the same detail", () => {
    const detail = fixture();
    expect(withSetRemoved(detail, "30000000-0000-4000-8000-000000000009")).toBe(detail);
  });

  it("never mutates its input (frozen) and leaves untouched exercises reference-equal", () => {
    const detail = fixture();
    const upserted = withSetUpserted(detail, { ...detail.exercises[0]!.sets[0]!, reps: 99 });
    const removed = withSetRemoved(detail, detail.exercises[0]!.sets[0]!.id);
    expect(upserted.exercises[1]).toBe(detail.exercises[1]);
    expect(removed.exercises[1]).toBe(detail.exercises[1]);
    expect(upserted).not.toBe(detail);
    expect(detail.exercises[0]!.sets[0]!.reps).toBe(8);
  });
});
