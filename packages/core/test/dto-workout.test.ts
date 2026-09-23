import { describe, expect, it } from "vitest";
import {
  AddWorkoutExerciseSchema,
  CreateWorkoutSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  WORKOUT_FUTURE_SKEW_MAX_MS,
  WORKOUT_NOTES_MAX,
  WORKOUT_STARTED_AT_PAST_MAX_MS,
  WORKOUT_TITLE_MAX,
  noControlCharsExceptWhitespace,
} from "../src/dto/workout.js";

const validWorkout = {
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
  title: "Push day",
  notes: null,
  startedAt: "2026-09-01T10:00:00.000Z",
  endedAt: null,
  localDate: "2026-09-01",
  tzOffsetMinutes: 0,
  clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
  source: "manual",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

describe("AC19 — dto/workout.ts code constants", () => {
  it("holds the §7/D47 values", () => {
    expect(WORKOUT_TITLE_MAX).toBe(120);
    expect(WORKOUT_NOTES_MAX).toBe(4000);
    expect(WORKOUT_FUTURE_SKEW_MAX_MS).toBe(300_000);
    expect(WORKOUT_STARTED_AT_PAST_MAX_MS).toBe(604_800_000);
  });
});

describe("AC19 — noControlCharsExceptWhitespace", () => {
  it("permits TAB, LF, CR", () => {
    expect(noControlCharsExceptWhitespace("line1\tline2\nline3\r")).toBe(true);
  });
  it("rejects every other C0 control char and DEL", () => {
    expect(noControlCharsExceptWhitespace("a\u0000b")).toBe(false);
    expect(noControlCharsExceptWhitespace("a\u007Fb")).toBe(false);
  });
});

describe("AC19/AC16 — WorkoutSchema", () => {
  it("parses a valid payload", () => {
    expect(() => WorkoutSchema.parse(validWorkout)).not.toThrow();
  });
  it("rejects a missing required field", () => {
    const rest: Record<string, unknown> = { ...validWorkout };
    delete rest.startedAt;
    expect(() => WorkoutSchema.parse(rest)).toThrow();
  });
});

describe("AC19/AC16 — CreateWorkoutSchema", () => {
  const validCreate = {
    clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
    startedAt: "2026-09-01T10:00:00.000Z",
  };
  it("parses a minimal valid payload (optionals omitted)", () => {
    expect(() => CreateWorkoutSchema.parse(validCreate)).not.toThrow();
  });
  it("rejects an unknown key", () => {
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, localDate: "2026-09-01" }),
    ).toThrow();
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, userId: "x" })).toThrow();
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, id: "x" })).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, source: "manual" }),
    ).toThrow();
  });
  it("rejects title over WORKOUT_TITLE_MAX and notes over WORKOUT_NOTES_MAX", () => {
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: "a".repeat(121) }),
    ).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: "a".repeat(120) }),
    ).not.toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, notes: "a".repeat(4001) }),
    ).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, notes: "a".repeat(4000) }),
    ).not.toThrow();
  });
  it("rejects an empty string but accepts null and omission", () => {
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, title: "" })).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: null }),
    ).not.toThrow();
  });
});

describe("AC19/AC16 — UpdateWorkoutSchema", () => {
  it("rejects localDate and tzOffsetMinutes as unknown keys", () => {
    expect(() => UpdateWorkoutSchema.parse({ localDate: "2026-09-01" })).toThrow();
    expect(() => UpdateWorkoutSchema.parse({ tzOffsetMinutes: 60 })).toThrow();
  });
  it("accepts an empty body and endedAt: null", () => {
    expect(() => UpdateWorkoutSchema.parse({})).not.toThrow();
    expect(() => UpdateWorkoutSchema.parse({ endedAt: null })).not.toThrow();
  });
});

describe("AC19/AC16 — AddWorkoutExerciseSchema / UpdateWorkoutExerciseSchema", () => {
  it("AddWorkoutExerciseSchema requires exerciseId, position optional", () => {
    expect(() =>
      AddWorkoutExerciseSchema.parse({
        exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000004",
      }),
    ).not.toThrow();
    expect(() => AddWorkoutExerciseSchema.parse({})).toThrow();
  });
  it("UpdateWorkoutExerciseSchema accepts a partial reorder/notes body", () => {
    expect(() => UpdateWorkoutExerciseSchema.parse({ position: 2 })).not.toThrow();
    expect(() => UpdateWorkoutExerciseSchema.parse({})).not.toThrow();
    expect(() => UpdateWorkoutExerciseSchema.parse({ position: -1 })).toThrow();
  });
});

describe("AC19 — WorkoutExerciseSchema / WorkoutDetailSchema", () => {
  const validWe = {
    id: "018fcb3e-3b8a-7d6e-9c1a-000000000005",
    workoutId: validWorkout.id,
    position: 0,
    exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000006",
    exerciseNameSnapshot: "Bench Press",
    modalitySnapshot: "weight_reps",
    notes: null,
    createdAt: validWorkout.createdAt,
    updatedAt: validWorkout.updatedAt,
  };
  it("WorkoutExerciseSchema parses a valid row", () => {
    expect(() => WorkoutExerciseSchema.parse(validWe)).not.toThrow();
  });
  it("WorkoutDetailSchema extends WorkoutSchema with an exercises array", () => {
    expect(() =>
      WorkoutDetailSchema.parse({ ...validWorkout, exercises: [validWe] }),
    ).not.toThrow();
  });
});
