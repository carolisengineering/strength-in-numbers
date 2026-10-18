import { describe, expect, it } from "vitest";
import { WorkoutDetailSchema, WorkoutExerciseSchema, WorkoutSchema, WorkoutSectionSchema, WorkoutSummarySchema } from "../src/index.js";

const G = (n: number) => `018fcb3e-3b8a-7d6e-9c1a-${String(n).padStart(12, "0")}`;
const T = "2026-10-13T10:00:00.000Z";
const exercise = {
  id: G(1), workoutId: G(2), position: 0, exerciseId: G(3), exerciseNameSnapshot: "Bench", modalitySnapshot: "weight_reps",
  notes: null, createdAt: T, updatedAt: T, targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, supersetGroup: null, plannedSets: [], sectionId: null, sets: [],
};
const detail = {
  id: G(2), title: null, notes: null, startedAt: T, endedAt: null, localDate: "2026-10-13", tzOffsetMinutes: 0,
  clientGeneratedId: G(9), source: "manual", createdAt: T, updatedAt: T, routineName: null, plannedDurationSeconds: null,
  exercises: [exercise], routineNotes: null, sections: [],
};

describe("AC1 — workout response shapes", () => {
  it("WorkoutSection is exactly { id, position, name, notes }", () => {
    expect(Object.keys(WorkoutSectionSchema.shape)).toEqual(["id", "position", "name", "notes"]);
  });
  it("WorkoutExercise ends with sectionId (after plannedSets)", () => {
    const keys = Object.keys(WorkoutExerciseSchema.shape);
    expect(keys.slice(-2)).toEqual(["plannedSets", "sectionId"]);
  });
  it("WorkoutDetail adds exercises, routineNotes, sections in that order", () => {
    expect(Object.keys(WorkoutDetailSchema.shape).slice(-3)).toEqual(["exercises", "routineNotes", "sections"]);
  });
  // Amended by 07.4 AC19: `plannedDurationSeconds` is the one key added since; still no section fields (D14).
  it("WorkoutSchema and WorkoutSummary are UNCHANGED (D14)", () => {
    expect(Object.keys(WorkoutSchema.shape)).toEqual([
      "id", "title", "notes", "startedAt", "endedAt", "localDate", "tzOffsetMinutes", "clientGeneratedId",
      "source", "createdAt", "updatedAt", "routineName", "plannedDurationSeconds",
    ]);
    expect(Object.keys(WorkoutSummarySchema.shape)).not.toContain("sections");
    expect(Object.keys(WorkoutSummarySchema.shape)).not.toContain("routineNotes");
  });
  it("a full detail parses", () => {
    expect(WorkoutDetailSchema.safeParse(detail).success).toBe(true);
  });
});

describe("AC26 — required, never defaulted (workout half)", () => {
  it("fails without sections, without routineNotes and without an exercise's sectionId", () => {
    const without = (o: Record<string, unknown>, key: string) => {
      const copy = { ...o };
      delete copy[key];
      return copy;
    };
    const noSections = without(detail, "sections");
    const noNotes = without(detail, "routineNotes");
    const noSectionId = without(exercise, "sectionId");
    expect(WorkoutDetailSchema.safeParse(noSections).success).toBe(false);
    expect(WorkoutDetailSchema.safeParse(noNotes).success).toBe(false);
    expect(WorkoutDetailSchema.safeParse({ ...detail, exercises: [noSectionId] }).success).toBe(false);
  });
});
