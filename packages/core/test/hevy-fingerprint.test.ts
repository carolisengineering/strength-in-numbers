import { describe, expect, it } from "vitest";
import { hevyFingerprintSource, type WorkoutDetail } from "../src/index.js";
import { detail, exercise, exerciseId, section, set } from "./fixtures/hevy/workout-detail.js";

// Built fresh on every call: a mutator must never reach the baseline.
const fin = () => section(0, "Finisher", { notes: "fast" });
const base = (): WorkoutDetail =>
  detail({
    title: "Push",
    notes: "n",
    routineName: "Upper",
    sections: [fin(), section(1, "Cooldown")],
    exercises: [
      exercise(0, { sectionId: fin().id, notes: "e", supersetGroup: 1, sets: [set({ rpe: 8, reps: 5 }), set({ setNumber: 2 })] }),
      exercise(1, { supersetGroup: 1 }),
    ],
  });

type Mutator = (d: WorkoutDetail) => void;
const ex0 = (d: WorkoutDetail) => d.exercises[0]!;
const set0 = (d: WorkoutDetail) => d.exercises[0]!.sets[0]!;

describe("19.0 AC13 — the fingerprint source", () => {
  it("starts with the version tag v1 and has no whitespace outside strings", () => {
    const source = hevyFingerprintSource(base());
    expect(source.startsWith("v1")).toBe(true);
    expect(hevyFingerprintSource(detail({ title: "A" }))).not.toMatch(/\s/);
  });

  const INCLUDED: [string, Mutator][] = [
    ["title", (d) => void (d.title = "Pull")],
    ["notes", (d) => void (d.notes = "other")],
    ["startedAt", (d) => void (d.startedAt = "2026-10-01T09:00:00.000-05:00")],
    ["endedAt", (d) => void (d.endedAt = "2026-10-01T12:00:00.000-05:00")],
    ["routineName", (d) => void (d.routineName = "Lower")],
    ["sections[0].name", (d) => void (d.sections[0]!.name = "Burnout")],
    ["sections[0].notes", (d) => void (d.sections[0]!.notes = "slow")],
    ["sections[0].position", (d) => void (d.sections[0]!.position = 5)],
    ["exercises[0].position", (d) => void (ex0(d).position = 9)],
    ["exercises[0].exerciseId", (d) => void (ex0(d).exerciseId = exerciseId(77) as never)],
    ["exercises[0].notes", (d) => void (ex0(d).notes = "x")],
    ["exercises[0].supersetGroup", (d) => void (ex0(d).supersetGroup = 2)],
    ["exercises[0].sectionId", (d) => void (ex0(d).sectionId = null)],
    ["sets[0].setType", (d) => void (set0(d).setType = "failure")],
    ["sets[0].reps", (d) => void (set0(d).reps = 6)],
    ["sets[0].weightKg", (d) => void (set0(d).weightKg = 61)],
    ["sets[0].distanceM", (d) => void (set0(d).distanceM = 10)],
    ["sets[0].durationS", (d) => void (set0(d).durationS = 10)],
    ["sets[0].calories", (d) => void (set0(d).calories = 10)],
    ["sets[0].rpe", (d) => void (set0(d).rpe = 9)],
  ];

  it.each(INCLUDED)("changes when %s changes", (_l, mutate) => {
    const changed = base();
    mutate(changed);
    expect(hevyFingerprintSource(changed)).not.toBe(hevyFingerprintSource(base()));
  });

  const EXCLUDED: [string, Mutator][] = [
    ["updatedAt", (d) => void (d.updatedAt = "2027-01-01T00:00:00.000Z")],
    ["createdAt", (d) => void (d.createdAt = "2027-01-01T00:00:00.000Z")],
    ["localDate", (d) => void (d.localDate = "2026-10-02")],
    ["tzOffsetMinutes", (d) => void (d.tzOffsetMinutes = 60)],
    ["a set id", (d) => void (set0(d).id = "00000000-0000-4000-8000-000000009999" as never)],
    ["an exercise id", (d) => void (ex0(d).id = "00000000-0000-4000-8000-000000009998" as never)],
    ["plannedSets", (d) => void (ex0(d).plannedSets = [{ setType: "working", reps: null, repsLow: 5, repsHigh: 8, weight: null, weightUnit: null, durationS: null, distance: null, distanceUnit: null, calories: null, rpe: null } as never])],
    ["isComplete", (d) => void (set0(d).isComplete = false)],
    ["completedAt", (d) => void (set0(d).completedAt = null)],
    ["routineIsOneOff", (d) => void (d.routineIsOneOff = true)],
    ["routineNotes", (d) => void (d.routineNotes = "from the routine")],
    ["addedInWorkout", (d) => void (d.sections[0]!.addedInWorkout = true)],
  ];

  it.each(EXCLUDED)("stays equal when %s changes", (_l, mutate) => {
    const changed = base();
    mutate(changed);
    expect(hevyFingerprintSource(changed)).toBe(hevyFingerprintSource(base()));
  });

  it("stays equal when the arrays are reordered without changing positions", () => {
    const shuffled = base();
    shuffled.exercises.reverse();
    shuffled.sections.reverse();
    shuffled.exercises.find((e) => e.position === 0)!.sets.reverse();
    expect(hevyFingerprintSource(shuffled)).toBe(hevyFingerprintSource(base()));
  });
});
