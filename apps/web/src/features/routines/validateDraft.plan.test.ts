import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, RoutineWriteSchema, type Modality } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import type { Draft, DraftItem, DraftSet } from "./routineDraft";
import { issueForPath, plannedViolationIssues, toRoutineInput, validateDraft, WEIGHT_NEEDS_SETS } from "./validateDraft";

const item = (key: string, o: Partial<DraftItem> = {}): DraftItem => ({
  key, exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, ...o,
});
const draftOf = (...items: DraftItem[]): Draft => ({ name: "Push A", notes: "", items, dirty: true, adjusted: false });
const row = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg", ...o });
const as = (m: Modality | null) => ({ modalityOf: () => m });
const allActive = { exerciseState: () => "active" as const };
const only = (body: ReturnType<typeof toRoutineInput>) => body.items[0]!;

describe("10.2 AC6 — the request body: exactly one form per item", () => {
  it("quick mode with a set count → N identical working rows with the quick weight and unit; no quick-line keys", () => {
    const body = only(toRoutineInput(draftOf(item("a", { targetSets: 3, targetRepsLow: 6, targetRepsHigh: 8, weight: 100, weightUnit: "kg" })), as("weight_reps")));
    expect(body.sets).toEqual(Array(3).fill({ setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" }));
    for (const key of ["targetSets", "targetRepsLow", "targetRepsHigh"]) expect(Object.hasOwn(body, key), key).toBe(false);
  });
  it("quick mode with a set count and nothing else → bare working rows", () => {
    expect(only(toRoutineInput(draftOf(item("a", { targetSets: 2 })), as("weight_reps"))).sets).toEqual([{ setType: "working" }, { setType: "working" }]);
  });
  it("quick mode without a set count → the legacy reps keys only (O1)", () => {
    const body = only(toRoutineInput(draftOf(item("a", { targetRepsLow: 8, targetRepsHigh: 10 })), as("weight_reps")));
    expect(body).toMatchObject({ targetRepsLow: 8, targetRepsHigh: 10 });
    expect(Object.hasOwn(body, "sets")).toBe(false);
    expect(Object.hasOwn(body, "targetSets")).toBe(false);
  });
  it("plan mode → the rows; setType always; reps and weight only when present; a unit only with a weight", () => {
    const body = only(toRoutineInput(draftOf(item("a", { targetSets: 3, plan: [row("r1", { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60 }), row("r2", { weight: null, weightUnit: null }), row("r3", { repsLow: null, repsHigh: null })] })), as("weight_reps")));
    expect(body.sets).toEqual([
      { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" },
      { setType: "working", repsLow: 6, repsHigh: 8 },
      { setType: "working", weight: 100, weightUnit: "kg" },
    ]);
    for (const key of ["targetSets", "targetRepsLow", "targetRepsHigh"]) expect(Object.hasOwn(body, key), key).toBe(false);
  });
  it("sends no row keys, positions or ids; RPE, rest, group and notes ride along with sets", () => {
    const body = only(toRoutineInput(draftOf(item("a", { targetSets: 1, weight: 5, weightUnit: "lb", targetRpe: 8.5, restSeconds: 90, notes: " hi " })), as("weight_reps")));
    expect(body).toEqual({ exerciseId: exerciseId(1), targetRpe: 8.5, restSeconds: 90, supersetGroup: null, notes: "hi", sets: [{ setType: "working", weight: 5, weightUnit: "lb" }] });
    expect(JSON.stringify(toRoutineInput(draftOf(item("secret-key", { plan: [row("secret-row")] })), as("weight_reps")))).not.toContain("secret");
  });

  // D6: fields the modality cannot carry are omitted, not sent.
  const FULL = { setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" };
  it.each<[Modality | null, Record<string, unknown>]>([
    ["weight_reps", FULL],
    ["weighted_bodyweight", FULL],
    ["bodyweight_reps", { setType: "working", repsLow: 6, repsHigh: 8 }],
    ["duration", { setType: "working" }],
    ["distance_duration", { setType: "working" }],
    [null, FULL], // the catalog has not synced: omit nothing
  ])("plan row for %s", (modality, expected) => {
    expect(only(toRoutineInput(draftOf(item("a", { plan: [row("r1")] })), as(modality))).sets).toEqual([expected]);
  });
  it.each<[Modality | null, Record<string, unknown>]>([
    ["weight_reps", FULL],
    ["bodyweight_reps", { setType: "working", repsLow: 6, repsHigh: 8 }],
    ["duration", { setType: "working" }],
    [null, FULL],
  ])("quick item for %s", (modality, expected) => {
    expect(only(toRoutineInput(draftOf(item("a", { targetSets: 1, targetRepsLow: 6, targetRepsHigh: 8, weight: 100, weightUnit: "kg" })), as(modality))).sets).toEqual([expected]);
  });
  it("a reps-only item on a timed exercise sends null reps (the stored values are cleaned, AC18)", () => {
    expect(only(toRoutineInput(draftOf(item("a", { targetRepsLow: 8, targetRepsHigh: 10 })), as("duration")))).toMatchObject({ targetRepsLow: null, targetRepsHigh: null });
  });
  it.each(MODALITY_VALUES)("every body for %s passes the shared write schema", (modality) => {
    const d = draftOf(item("a", { targetSets: 2, weight: 5, weightUnit: "kg" }), item("b", { plan: [row("r1"), row("r2", { setType: "drop" })] }), item("c", { targetRepsLow: 5, targetRepsHigh: 5 }));
    expect(RoutineWriteSchema.safeParse(toRoutineInput(d, as(modality))).success).toBe(true);
  });
});

describe("10.2 AC7 — validation", () => {
  it("a valid quick or plan draft is ok", () => {
    expect(validateDraft(draftOf(item("a", { targetSets: 3, weight: 100, weightUnit: "kg" }), item("b", { plan: [row("r1")] })), { ...allActive, ...as("weight_reps") })).toEqual({ ok: true, issues: [], groupBug: false });
  });
  it("a weight with no set count is a client-owned issue on the Weight field (P7)", () => {
    const v = validateDraft(draftOf(item("a", { weight: 100, weightUnit: "kg" })), { ...allActive, ...as("weight_reps") });
    expect(v.ok).toBe(false);
    expect(v.issues).toEqual([{ scope: "item", itemKey: "a", field: "weight", message: WEIGHT_NEEDS_SETS }]);
  });
  it("…but not for an exercise that cannot carry a weight (it is omitted instead)", () => {
    expect(validateDraft(draftOf(item("a", { weight: 100, weightUnit: "kg" })), { ...allActive, ...as("bodyweight_reps") }).ok).toBe(true);
  });
  it("the 10.0 call shape (no modalityOf) still works", () => {
    expect(validateDraft(draftOf(item("a")), allActive).ok).toBe(true);
  });
});

describe("10.2 AC7 — issue mapping (the same table serves the server's 422, AC8)", () => {
  const keys = ["a", "b"];
  const plans = [null, ["r1", "r2"]];
  it.each([
    ["items.0.sets.1.weight", { scope: "item", itemKey: "a", field: "weight" }],
    ["items.0.sets.0.weightUnit", { scope: "item", itemKey: "a", field: "weight" }],
    ["items.0.sets.2.repsLow", { scope: "item", itemKey: "a", field: "targetRepsLow" }],
    ["items.0.sets.2.repsHigh", { scope: "item", itemKey: "a", field: "targetRepsHigh" }],
    ["items.0.sets", { scope: "item", itemKey: "a", field: "targetSets" }],
    ["items.1.sets.1.weight", { scope: "row", itemKey: "b", rowKey: "r2", field: "weight" }],
    ["items.1.sets.0.repsLow", { scope: "row", itemKey: "b", rowKey: "r1", field: "reps" }],
    ["items.1.sets.0.repsHigh", { scope: "row", itemKey: "b", rowKey: "r1", field: "reps" }],
    ["items.1.sets", { scope: "item", itemKey: "b", field: "targetSets" }],
  ])("%s", (path, expected) => {
    expect(issueForPath(path.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s)), keys, plans)).toMatchObject(expected);
  });
  it("a path naming a row that is not on screen maps to null (form-level)", () => {
    expect(issueForPath(["items", 1, "sets", 9, "weight"], keys, plans)).toBeNull();
    expect(issueForPath(["items", 1, "sets", 0, "setType"], keys, plans)).toBeNull();
  });
  it("messages come from the static table and never echo input", () => {
    const issue = issueForPath(["items", 0, "sets", 0, "weight"], keys, plans);
    expect(issue?.message).toMatch(/weight/i);
  });
  it("the 10.0 two-argument call shape is unchanged", () => {
    expect(issueForPath(["items", 0, "targetSets"], keys)).toMatchObject({ scope: "item", field: "targetSets" });
  });
});

describe("10.2 AC7 — parity with plannedSetViolations", () => {
  it("a body that carries a measure its exercise cannot use maps each violation to its row or field", () => {
    const quick = item("a", { targetSets: 1, weight: 5, weightUnit: "kg" });
    const plan = item("b", { plan: [row("r1")] });
    const d = draftOf(quick, plan);
    const body = { name: "x", items: [{ exerciseId: exerciseId(1), sets: [{ setType: "working", weight: 5, weightUnit: "kg" }] }, { exerciseId: exerciseId(1), sets: [{ setType: "working", repsLow: 6, repsHigh: 8 }] }] } as ReturnType<typeof toRoutineInput>;
    const issues = plannedViolationIssues(d, body, () => "bodyweight_reps");
    expect(issues).toContainEqual(expect.objectContaining({ scope: "item", itemKey: "a", field: "weight" }));
    const durationIssues = plannedViolationIssues(d, body, () => "duration");
    expect(durationIssues).toContainEqual(expect.objectContaining({ scope: "row", itemKey: "b", rowKey: "r1", field: "reps" }));
  });
  it("a body the editor itself built has no violations for any modality", () => {
    for (const modality of MODALITY_VALUES) {
      const d = draftOf(item("a", { targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, weight: 5, weightUnit: "kg" }), item("b", { plan: [row("r1")] }));
      expect(plannedViolationIssues(d, toRoutineInput(d, as(modality)), () => modality)).toEqual([]);
    }
  });
});
