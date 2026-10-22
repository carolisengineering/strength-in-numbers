import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { lookupIn, REMOVED_EXERCISE_NAME } from "./exerciseLookup";

describe("10.4 AC30 — the lookup answers for pending exercises", () => {
  const pending = new Map([["ph-1", { name: "Hand Release Pushups", modality: "bodyweight_reps" as const }]]);
  it("a placeholder reads as an active, new exercise with its modality", () => {
    expect(lookupIn([], { synced: true, pending })("ph-1")).toEqual({ name: "Hand Release Pushups", state: "active", modality: "bodyweight_reps", isNew: true });
    expect(lookupIn([], { synced: true, pending })("other")).toEqual({ name: REMOVED_EXERCISE_NAME, state: "missing", modality: null });
  });
  it("without pending exercises nothing changes: a catalog row has no isNew", () => {
    const rows = [makeExercise({ id: exerciseId(1), name: "Bench Press" })];
    expect(lookupIn(rows, { synced: true })(exerciseId(1))).toEqual({ name: "Bench Press", state: "active", modality: "weight_reps" });
    expect(lookupIn(rows, { synced: true, pending })(exerciseId(1))).not.toHaveProperty("isNew");
  });
});
