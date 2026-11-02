import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CreateWorkoutSectionSchema,
  RoutineItemSchema,
  RoutineSectionSchema,
  UpdateWorkoutSectionSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  WorkoutSectionSchema,
} from "../src/index.js";

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("09.4 AC4 — CreateWorkoutSectionSchema field matrix", () => {
  it.each([
    [{ name: "Warm-up" }, []],
    [{ name: "  Warm-up  " }, []],
    [{ name: "x".repeat(40) }, []],
    [{ name: "x".repeat(41) }, ["name"]],
    [{ name: "" }, ["name"]],
    [{ name: "   " }, ["name"]], // Review Focus 1: trim runs before min(1)
    [{ name: "Warm\nup" }, ["name"]], // Review Focus 5
    [{ name: "A", notes: null }, []],
    [{ name: "A", notes: "" }, ["notes"]],
    [{ name: "A", notes: "n".repeat(2000) }, []],
    [{ name: "A", notes: "n".repeat(2001) }, ["notes"]],
    [{ name: "A", notes: "EMOM\t10 min\r\nrest" }, []], // Review Focus 5
    [{ name: "A", notes: "a\u0007b" }, ["notes"]],
    [{}, ["name"]],
    [{ name: "", notes: "" }, ["name", "notes"]], // collected
  ] as [unknown, string[]][])("%j → %j", (body, expected) => {
    expect(paths(CreateWorkoutSectionSchema.safeParse(body))).toEqual(expected);
  });

  it("trims the name", () => {
    expect(CreateWorkoutSectionSchema.parse({ name: "  Warm-up  " }).name).toBe("Warm-up");
  });

  it.each(["position", "addedInWorkout", "id"])("unknown key %s is rejected", (key) => {
    expect(CreateWorkoutSectionSchema.safeParse({ name: "A", [key]: 0 }).success).toBe(false);
  });
});

describe("09.4 AC4 — UpdateWorkoutSectionSchema field matrix", () => {
  it.each([
    [{}, []],
    [{ notes: null }, []],
    [{ name: "B" }, []],
    [{ name: "   " }, ["name"]],
    [{ notes: "" }, ["notes"]],
  ] as [unknown, string[]][])("%j → %j", (body, expected) => {
    expect(paths(UpdateWorkoutSectionSchema.safeParse(body))).toEqual(expected);
  });

  it.each(["position", "addedInWorkout", "id"])("unknown key %s is rejected", (key) => {
    expect(UpdateWorkoutSectionSchema.safeParse({ [key]: 1 }).success).toBe(false);
  });
});

describe("09.5 AC1 — contract", () => {
  const G = (n: number) => `018fcb3e-3b8a-7d6e-9c1a-${String(n).padStart(12, "0")}`;
  const workoutSection = {
    id: G(1), position: 0, name: "Main", notes: null, addedInWorkout: false,
    timer: { format: "set_timer", roundSeconds: 300, rounds: 5 }, result: null, roundTimes: [{ round: 1, seconds: 221 }],
  };
  const routineSection = { id: G(2), position: 0, name: "Main", notes: null, timer: { format: "time_cap", capSeconds: null } };

  it("WorkoutSection keys, in order, end with timer, result, roundTimes", () => {
    expect(Object.keys(WorkoutSectionSchema.shape)).toEqual(["id", "position", "name", "notes", "addedInWorkout", "timer", "result", "roundTimes"]);
    expect(Object.keys(WorkoutSectionSchema.parse(workoutSection))).toEqual(["id", "position", "name", "notes", "addedInWorkout", "timer", "result", "roundTimes"]);
  });

  it("RoutineSection keys end with timer", () => {
    expect(Object.keys(RoutineSectionSchema.shape)).toEqual(["id", "position", "name", "notes", "timer"]);
    expect(RoutineSectionSchema.safeParse(routineSection).success).toBe(true);
  });

  it.each(["timer", "result", "roundTimes"])("WorkoutSection.%s is required", (key) => {
    const body: Record<string, unknown> = { ...workoutSection };
    delete body[key];
    expect(WorkoutSectionSchema.safeParse(body).success).toBe(false);
  });

  it("RoutineSection.timer is required; roundTimes is never null; a time_cap response carries its cap", () => {
    const body: Record<string, unknown> = { ...routineSection };
    delete body["timer"];
    expect(RoutineSectionSchema.safeParse(body).success).toBe(false);
    expect(WorkoutSectionSchema.safeParse({ ...workoutSection, roundTimes: null }).success).toBe(false);
    expect(RoutineSectionSchema.safeParse({ ...routineSection, timer: { format: "time_cap" } }).success).toBe(false);
    expect(WorkoutSectionSchema.safeParse({ ...workoutSection, timer: null, result: null, roundTimes: [] }).success).toBe(true);
  });

  it("Workout, WorkoutExercise and RoutineItem key sets are unchanged", () => {
    expect(Object.keys(WorkoutSchema.shape)).toEqual([
      "id", "title", "notes", "startedAt", "endedAt", "localDate", "tzOffsetMinutes", "clientGeneratedId", "source",
      "createdAt", "updatedAt", "routineName", "plannedDurationSeconds",
    ]);
    expect(Object.keys(WorkoutExerciseSchema.shape)).toEqual([
      "id", "workoutId", "position", "exerciseId", "exerciseNameSnapshot", "modalitySnapshot", "notes", "createdAt", "updatedAt",
      "targetSets", "targetRepsLow", "targetRepsHigh", "targetRpe", "restSeconds", "supersetGroup", "plannedSets", "sectionId",
    ]);
    expect(Object.keys(RoutineItemSchema.shape)).toEqual([
      "id", "position", "exerciseId", "targetSets", "targetRepsLow", "targetRepsHigh", "targetRpe", "restSeconds", "supersetGroup",
      "notes", "sets", "sectionId",
    ]);
  });

  it("the new keys are never defaulted or caught", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["../src/dto/workout.ts", "../src/dto/routine-section.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      for (const key of ["timer", "result", "roundTimes"]) {
        // Response schemas only: a request schema's `timer` (`SectionTimerInputSchema`) is optional by design.
        const line = source.split("\n").find((l) => new RegExp(`^\\s*${key}:`).test(l) && !l.includes("InputSchema"));
        if (line !== undefined) expect(line, `${file} ${key}`).not.toMatch(/\.default\(|\.catch\(|\.optional\(/);
      }
    }
  });
});
