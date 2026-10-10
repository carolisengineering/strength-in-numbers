// apps/web/src/features/routines/exerciseLookup.test.ts
import { describe, expect, it } from "vitest";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { lookupIn, REMOVED_EXERCISE_NAME, UNKNOWN_EXERCISE_NAME } from "./exerciseLookup";

describe("10.0 AC30 — exercise lookup reads raw catalog rows", () => {
  const rows = [
    makeExercise({ id: exerciseId(1), name: "Bench Press" }),
    makeExercise({ id: exerciseId(2), name: "Old Row", isActive: false }),
    makeExercise({ id: exerciseId(3), name: "Curated Squat" }), // a fork origin: still active
    makeExercise({ id: exerciseId(4), name: "My Squat", ownerUserId: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c", forkedFromExerciseId: exerciseId(3) }),
  ];
  it("active, retired, fork origin; an absent id is unknown before a sync", () => {
    const lookup = lookupIn(rows, { synced: false });
    expect(lookup(exerciseId(1))).toEqual({ name: "Bench Press", state: "active" });
    expect(lookup(exerciseId(2))).toEqual({ name: "Old Row", state: "retired" });
    expect(lookup(exerciseId(3))).toEqual({ name: "Curated Squat", state: "active" });
    expect(lookup(exerciseId(99))).toEqual({ name: UNKNOWN_EXERCISE_NAME, state: "unknown" });
  });

  it("after a sync an absent id is missing: sync drops retired and deleted rows", () => {
    expect(lookupIn(rows, { synced: true })(exerciseId(99))).toEqual({ name: REMOVED_EXERCISE_NAME, state: "missing" });
  });
});
