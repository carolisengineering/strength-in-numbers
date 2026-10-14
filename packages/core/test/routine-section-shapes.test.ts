// packages/core/test/routine-section-shapes.test.ts
import { describe, expect, it } from "vitest";
import { RoutineItemSchema, RoutineSchema, RoutineSectionSchema } from "../src/index.js";

const G = (n: number) => `018fcb3e-3b8a-7d6e-9c1a-${String(n).padStart(12, "0")}`;
const item = {
  id: G(1), position: 0, exerciseId: G(2), targetSets: null, targetRepsLow: null, targetRepsHigh: null,
  targetRpe: null, restSeconds: null, supersetGroup: null, notes: null, sets: [], sectionId: null,
};
const routine = {
  id: G(3), name: "R", notes: null, sections: [{ id: G(4), position: 0, name: "Main", notes: null }],
  items: [item], createdAt: "2026-10-13T10:00:00.000Z", updatedAt: "2026-10-13T10:00:00.000Z",
};

describe("AC1 — routine response shapes", () => {
  it("RoutineSection is exactly { id, position, name, notes } (no key, no routineId)", () => {
    expect(Object.keys(RoutineSectionSchema.shape)).toEqual(["id", "position", "name", "notes"]);
  });
  it("Routine key order puts sections between notes and items; RoutineItem ends with sectionId", () => {
    expect(Object.keys(RoutineSchema.shape)).toEqual(["id", "name", "notes", "sections", "items", "createdAt", "updatedAt"]);
    const keys = Object.keys(RoutineItemSchema.shape);
    expect(keys[keys.length - 1]).toBe("sectionId");
  });
  it("a full routine parses", () => {
    expect(RoutineSchema.safeParse(routine).success).toBe(true);
  });
});

describe("AC26 — required, never defaulted (routine half)", () => {
  it("a Routine without sections and a RoutineItem without sectionId fail safeParse", () => {
    const noSections: Record<string, unknown> = { ...routine };
    delete noSections["sections"];
    expect(RoutineSchema.safeParse(noSections).success).toBe(false);
    const noSectionId: Record<string, unknown> = { ...item };
    delete noSectionId["sectionId"];
    expect(RoutineItemSchema.safeParse(noSectionId).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, sections: null }).success).toBe(false);
  });
});
