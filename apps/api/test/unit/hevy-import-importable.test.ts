import { describe, expect, it } from "vitest";
import type { ImportedWorkout, ImportedWorkoutSet } from "@sin/core";
import { importableProblem } from "../../src/repositories/hevy-import.prisma.js";

const set = (over: Partial<ImportedWorkoutSet> = {}): ImportedWorkoutSet => ({
  setType: "working",
  reps: 5,
  weight: 60,
  weightUnit: "kg",
  distance: null,
  distanceUnit: null,
  durationS: null,
  calories: null,
  rpe: null,
  isComplete: true,
  setNumber: 1,
  ...over,
});

const workout = (over: Partial<ImportedWorkout> = {}): ImportedWorkout => ({
  title: "Push",
  notes: null,
  startedAt: "2026-09-10T10:00:00.000Z",
  endedAt: "2026-09-10T11:00:00.000Z",
  localDate: "2026-09-10",
  tzOffsetMinutes: 0,
  sections: [],
  exercises: [
    {
      exerciseId: "0192f0c0-0000-7000-8000-000000000001",
      nameSnapshot: "Bench Press",
      modalitySnapshot: "weight_reps",
      notes: null,
      supersetGroup: null,
      sectionIndex: null,
      sets: [set()],
    },
  ],
  rootIds: ["0192f0c0-0000-7000-8000-000000000001"],
  ...over,
});

describe("Minor 164 — the importable re-check returns a reason", () => {
  it("a valid body gives null", () => {
    expect(importableProblem(workout())).toBeNull();
  });

  it("an inverted time gives a reason", () => {
    expect(importableProblem(workout({ endedAt: "2026-09-10T09:00:00.000Z" }))).toEqual(expect.any(String));
  });

  it("an exercise with no sets gives a reason", () => {
    const w = workout();
    w.exercises[0]!.sets = [];
    expect(importableProblem(w)).toEqual(expect.any(String));
  });

  it("an unknown section index gives a reason", () => {
    const w = workout();
    w.exercises[0]!.sectionIndex = 0;
    expect(importableProblem(w)).toEqual(expect.any(String));
  });

  it("a set that breaks its measure rules gives a reason, never a thrown error", () => {
    const w = workout();
    w.exercises[0]!.sets = [set({ distance: 5, distanceUnit: "m" })];
    expect(importableProblem(w)).toEqual(expect.any(String));
  });
});
