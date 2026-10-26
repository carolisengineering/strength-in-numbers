import { describe, expect, it } from "vitest";
import { RoutineWriteSchema, type Modality } from "@sin/core";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { lookupIn, REMOVED_EXERCISE_NAME } from "./exerciseLookup";
import type { Draft, DraftItem } from "./routineDraft";
import { targetLine } from "./targetFormat";
import { plannedViolationIssues, toRoutineInput, validateDraft, WEIGHT_NEEDS_SETS } from "./validateDraft";

const item = (key: string, o: Partial<DraftItem> = {}): DraftItem => ({
  key, exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, sectionKey: null, ...o,
});
const draftOf = (...items: DraftItem[]): Draft => ({ name: "Engine", notes: "", sections: [], items, dirty: true, adjusted: false, unlinkNotice: false });
const as = (m: Modality) => ({ modalityOf: () => m });
const REPS_KEYS = ["repsLow", "repsHigh", "targetRepsLow", "targetRepsHigh"];

describe("18.1 AC23 — request bodies", () => {
  it("a calories item sends no reps and no weight, and nothing 09.1 refuses", () => {
    const draft = draftOf(item("a", { targetSets: 3, targetRepsLow: 10, targetRepsHigh: 10, weight: 20, weightUnit: "kg" }));
    const body = toRoutineInput(draft, as("calories"));
    const json = JSON.stringify(body.items[0]);
    for (const key of [...REPS_KEYS, "weight", "weightUnit"]) expect(json).not.toContain(`"${key}"`);
    expect(RoutineWriteSchema.safeParse(body).success).toBe(true);
    expect(plannedViolationIssues(draft, body, () => "calories")).toEqual([]);
  });
  it.each(["weight_distance", "weight_duration"] as const)("%s: 3 sets at 24 kg send weighted rows with no reps", (modality) => {
    const draft = draftOf(item("a", { targetSets: 3, weight: 24, weightUnit: "kg" }));
    const body = toRoutineInput(draft, as(modality));
    const sets = (body.items[0] as { sets?: { weight: number | null; weightUnit: string | null }[] }).sets;
    expect(sets).toHaveLength(3);
    for (const s of sets!) expect(s).toMatchObject({ weight: 24, weightUnit: "kg" });
    for (const key of ["targetRepsLow", "targetRepsHigh"]) expect(Object.hasOwn(body.items[0]!, key), key).toBe(false);
    for (const s of sets!) for (const key of ["repsLow", "repsHigh"]) expect(Object.hasOwn(s, key), key).toBe(false);
    expect(plannedViolationIssues(draft, body, () => modality)).toEqual([]);
  });
  it("a carry weight with no set count is still blocked by the existing message", () => {
    const v = validateDraft(draftOf(item("a", { weight: 24, weightUnit: "kg" })), { exerciseState: () => "active", ...as("weight_distance") });
    expect(v.issues).toEqual([{ scope: "item", itemKey: "a", field: "weight", message: WEIGHT_NEEDS_SETS }]);
  });
});

describe("18.1 AC24 — target lines", () => {
  it("a planned carry reads 3 sets @ 24 kg · 2:00; a calories item reads 3 sets", () => {
    const targets = { targetSets: 3, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: 120 };
    const rows = Array.from({ length: 3 }, () => ({ setType: "working" as const, repsLow: null, repsHigh: null, weight: 24, weightUnit: "kg" as const }));
    expect(targetLine(targets, rows)).toBe("3 sets @ 24 kg · 2:00");
    expect(targetLine({ ...targets, restSeconds: null })).toBe("3 sets");
  });
  it("an item whose exercise is missing still reads Removed exercise", () => {
    expect(lookupIn([makeExercise({ id: exerciseId(2) })], { synced: true })(exerciseId(9)).name).toBe(REMOVED_EXERCISE_NAME);
  });
});
