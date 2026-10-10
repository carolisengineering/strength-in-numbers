import { describe, expect, it } from "vitest";
import { ROUTINE_NAME_MAX, RoutineWriteSchema } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import type { Draft, DraftItem } from "./routineDraft";
import {
  GROUP_BUG,
  issueForPath,
  ITEMS_REQUIRED,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  nameTaken,
  splitPath,
  toRoutineInput,
  UNAVAILABLE,
  validateDraft,
} from "./validateDraft";

const item = (key: string, overrides: Partial<DraftItem> = {}): DraftItem => ({
  key,
  exerciseId: exerciseId(1),
  targetSets: null,
  targetRepsLow: null,
  targetRepsHigh: null,
  targetRpe: null,
  restSeconds: null,
  notes: null,
  supersetGroup: null,
  ...overrides,
});
const draft = (overrides: Partial<Draft> = {}): Draft => ({
  name: "Push A",
  notes: "",
  items: [item("a")],
  dirty: true,
  adjusted: false,
  ...overrides,
});
const allActive = { exerciseState: () => "active" as const };

describe("10.0 AC6 — the payload", () => {
  it("trims, omits blanks, keeps decimal RPE, sends no position / key / id", () => {
    const body = toRoutineInput(
      draft({
        name: "  Push A ",
        notes: "   ",
        items: [
          item("a", { targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8.5, restSeconds: 0, supersetGroup: 1, notes: "  slow " }),
          item("b", { exerciseId: exerciseId(2), supersetGroup: 1, notes: "  " }),
          item("c", { exerciseId: exerciseId(1) }),
        ],
      }),
    );
    expect(body).toEqual({
      name: "Push A",
      items: [
        { exerciseId: exerciseId(1), targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8.5, restSeconds: 0, supersetGroup: 1, notes: "slow" },
        { exerciseId: exerciseId(2), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: 1 },
        { exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: null },
      ],
    });
    const parsed = RoutineWriteSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.items.map((i) => i.supersetGroup)).toEqual([1, 1, null]);
  });

  it("keeps routine notes when present", () => {
    expect(toRoutineInput(draft({ notes: " Heavy " })).notes).toBe("Heavy");
  });
});

describe("10.0 AC7 — validation", () => {
  it("accepts a valid draft", () => {
    expect(validateDraft(draft(), allActive)).toEqual({ ok: true, issues: [], groupBug: false });
  });

  it("name required, then length, in app wording", () => {
    expect(validateDraft(draft({ name: "  " }), allActive).issues).toEqual([{ scope: "name", message: NAME_REQUIRED }]);
    expect(validateDraft(draft({ name: "x".repeat(ROUTINE_NAME_MAX + 1) }), allActive).issues).toEqual([
      { scope: "name", message: NAME_TOO_LONG },
    ]);
  });

  it("Review Focus 3 — emoji count as the server schema counts them (code points)", () => {
    const write = (name: string) => RoutineWriteSchema.safeParse({ name, items: [{ exerciseId: exerciseId(1) }] }).success;
    const at = "💪".repeat(ROUTINE_NAME_MAX);
    const over = "💪".repeat(ROUTINE_NAME_MAX + 1);
    expect(validateDraft(draft({ name: at }), allActive).ok).toBe(write(at));
    expect(validateDraft(draft({ name: at }), allActive).ok).toBe(true);
    expect(validateDraft(draft({ name: over }), allActive).issues).toEqual([{ scope: "name", message: NAME_TOO_LONG }]);
    expect(write(over)).toBe(false);
  });

  it("an empty list says Add at least one exercise", () => {
    expect(validateDraft(draft({ items: [] }), allActive).issues).toEqual([{ scope: "items", message: ITEMS_REQUIRED }]);
  });

  it("retired exercises (catalog or server-flagged) block, on that row", () => {
    const result = validateDraft(
      draft({ items: [item("a", { exerciseId: exerciseId(9) }), item("b", { retired: true })] }),
      { exerciseState: (id) => (id === exerciseId(9) ? "retired" : "active") },
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { scope: "item", itemKey: "a", field: "exerciseId", message: UNAVAILABLE },
      { scope: "item", itemKey: "b", field: "exerciseId", message: UNAVAILABLE },
    ]);
  });

  it("an unknown exercise (catalog not loaded) is not retired", () => {
    expect(validateDraft(draft(), { exerciseState: () => "unknown" }).ok).toBe(true);
  });

  it("a missing exercise does not block — the store may be stale; the server's 409 decides", () => {
    expect(validateDraft(draft(), { exerciseState: () => "missing" }).ok).toBe(true);
  });

  it("maps a schema issue on an item field to that row, in app wording", () => {
    const result = validateDraft(draft({ items: [item("a", { targetRepsLow: 10, targetRepsHigh: 8 })] }), allActive);
    expect(result.issues).toEqual([{ scope: "item", itemKey: "a", field: "targetRepsLow", message: expect.stringMatching(/reps/i) }]);
    expect(result.issues[0]!.message).not.toMatch(/targetRepsHigh/);
  });

  it("a group-size issue is a form error and flags groupBug", () => {
    const result = validateDraft(draft({ items: [item("a", { supersetGroup: 1 }), item("b")] }), allActive);
    expect(result.groupBug).toBe(true);
    expect(result.issues).toContainEqual({ scope: "form", message: GROUP_BUG });
  });

  it("issueForPath maps API paths through splitPath", () => {
    const keys = ["k0", "k1"];
    expect(issueForPath(splitPath("items.1.restSeconds"), keys)).toMatchObject({ scope: "item", itemKey: "k1", field: "restSeconds" });
    expect(issueForPath(splitPath("name"), keys)).toMatchObject({ scope: "name" });
    expect(issueForPath(splitPath("items"), keys)).toMatchObject({ scope: "items" });
    expect(issueForPath(splitPath("items.7.targetSets"), keys)).toBeNull();
    expect(issueForPath(splitPath("bogus"), keys)).toBeNull();
  });
});

describe("10.0 AC8 — duplicate-name warning", () => {
  const routines = [makeRoutine({ id: routineId(1), name: "Push A" }), makeRoutine({ id: routineId(2), name: "Pull" })];
  it("matches trimmed and case-insensitively, never itself", () => {
    expect(nameTaken("push a", routines)).toBe(true);
    expect(nameTaken("  PUSH A ", routines)).toBe(true);
    expect(nameTaken("Push B", routines)).toBe(false);
    expect(nameTaken("push a", routines, routineId(1))).toBe(false);
    expect(nameTaken("", routines)).toBe(false);
  });
});
