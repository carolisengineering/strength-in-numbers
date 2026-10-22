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
  REQUIRES_FINISH,
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
  routineName: null,
  plannedDurationSeconds: null,
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

describe("07.4 AC19 — WorkoutSchema.plannedDurationSeconds is required-nullable", () => {
  it("accepts null and an integer; a payload without the key fails", () => {
    expect(WorkoutSchema.safeParse({ ...validWorkout, plannedDurationSeconds: 3600 }).success).toBe(true);
    const rest: Record<string, unknown> = { ...validWorkout };
    delete rest.plannedDurationSeconds;
    expect(WorkoutSchema.safeParse(rest).success).toBe(false);
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
  // Amended by 07.4 AC19: tzOffsetMinutes is now a key, but only together with startedAt.
  it("rejects localDate as an unknown key and tzOffsetMinutes without startedAt", () => {
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
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetRpe: null,
    restSeconds: null,
    supersetGroup: null,
    plannedSets: [],
    sectionId: null,
  };
  it("WorkoutExerciseSchema parses a valid row", () => {
    expect(() => WorkoutExerciseSchema.parse(validWe)).not.toThrow();
  });
  it("WorkoutDetailSchema extends WorkoutSchema with an exercises array", () => {
    expect(() =>
      WorkoutDetailSchema.parse({ ...validWorkout, exercises: [{ ...validWe, sets: [] }], routineNotes: null, sections: [] }),
    ).not.toThrow();
  });
});

describe("Spec 09 AC24 — additive read fields", () => {
  it("WorkoutSchema requires routineName (nullable); WorkoutExerciseSchema requires the six target fields", () => {
    const { routineName: _omitted, ...withoutRoutineName } = validWorkout;
    void _omitted;
    expect(WorkoutSchema.safeParse(withoutRoutineName).success).toBe(false);
    expect(WorkoutSchema.safeParse({ ...withoutRoutineName, routineName: null }).success).toBe(true);
    expect(WorkoutSchema.safeParse({ ...withoutRoutineName, routineName: "Push A" }).success).toBe(true);
    const we = {
      id: "018fcb3e-3b8a-7d6e-9c1a-000000000003",
      workoutId: validWorkout.id,
      position: 0,
      exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000004",
      exerciseNameSnapshot: "Bench",
      modalitySnapshot: "weight_reps",
      notes: null,
      createdAt: validWorkout.createdAt,
      updatedAt: validWorkout.updatedAt,
    };
    expect(WorkoutExerciseSchema.safeParse(we).success).toBe(false);
    const full = {
      ...we,
      targetSets: null,
      targetRepsLow: null,
      targetRepsHigh: null,
      targetRpe: 8.5,
      restSeconds: null,
      supersetGroup: null,
      plannedSets: [],
      sectionId: null,
    };
    expect(WorkoutExerciseSchema.safeParse(full).success).toBe(true);
  });
  it("CreateWorkoutSchema takes an optional routineId (uuid); UpdateWorkoutExerciseSchema takes supersetGroup 1..99 | null", () => {
    const base = { clientGeneratedId: validWorkout.clientGeneratedId, startedAt: validWorkout.startedAt };
    expect(CreateWorkoutSchema.safeParse({ ...base, routineId: validWorkout.id }).success).toBe(true);
    expect(CreateWorkoutSchema.safeParse({ ...base, routineId: "not-a-uuid" }).success).toBe(false);
    expect(UpdateWorkoutExerciseSchema.safeParse({ supersetGroup: null }).success).toBe(true);
    expect(UpdateWorkoutExerciseSchema.safeParse({ supersetGroup: 99, position: 1 }).success).toBe(true);
    for (const bad of [0, 100, 2.5, "1"]) {
      expect(UpdateWorkoutExerciseSchema.safeParse({ supersetGroup: bad }).success, String(bad)).toBe(false);
    }
  });
});

describe("10.1 AC26 — routine-derived response fields stay required-nullable", () => {
  const full = {
    id: "018fcb3e-3b8a-7d6e-9c1a-000000000007",
    workoutId: validWorkout.id,
    position: 0,
    exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000008",
    exerciseNameSnapshot: "Bench",
    modalitySnapshot: "weight_reps",
    notes: null,
    createdAt: validWorkout.createdAt,
    updatedAt: validWorkout.updatedAt,
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetRpe: null,
    restSeconds: null,
    supersetGroup: null,
    plannedSets: [],
    sectionId: null,
  };
  const SIX =["targetSets", "targetRepsLow", "targetRepsHigh", "targetRpe", "restSeconds", "supersetGroup"] as const;
  it("a Workout without routineName fails", () => {
    const { routineName: _omitted, ...without } = validWorkout;
    void _omitted;
    expect(WorkoutSchema.safeParse(without).success).toBe(false);
  });
  it.each(SIX)("a WorkoutExercise without %s fails; null passes", (field) => {
    expect(WorkoutExerciseSchema.safeParse(full).success).toBe(true);
    const without: Record<string, unknown> = { ...full };
    delete without[field];
    expect(WorkoutExerciseSchema.safeParse(without).success).toBe(false);
  });
});

describe("07.4 AC19 — UpdateWorkoutSchema Change Time keys", () => {
  const issue = (body: unknown) => {
    const r = UpdateWorkoutSchema.safeParse(body);
    return r.success ? null : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  };
  it("accepts startedAt, tzOffsetMinutes with startedAt, and durationSeconds 0..86400 or null", () => {
    expect(issue({ startedAt: "2026-09-01T10:00:00.000Z", tzOffsetMinutes: -300 })).toBeNull();
    expect(issue({ durationSeconds: 0 })).toBeNull();
    expect(issue({ durationSeconds: 86_400 })).toBeNull();
    expect(issue({ durationSeconds: null })).toBeNull();
    expect(issue({ startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T11:00:00.000Z" })).toBeNull();
  });
  it("tzOffsetMinutes without startedAt is refused on tzOffsetMinutes with a static message", () => {
    expect(issue({ tzOffsetMinutes: 60 })).toEqual([{ path: "tzOffsetMinutes", message: "requires startedAt" }]);
  });
  it("durationSeconds with a non-null endedAt is refused on durationSeconds; endedAt: null is fine", () => {
    expect(issue({ endedAt: "2026-09-01T11:00:00.000Z", durationSeconds: 60 })).toEqual([{ path: "durationSeconds", message: "cannot be combined with endedAt" }]);
    expect(issue({ endedAt: null, durationSeconds: 60 })).toBeNull();
  });
  it("out-of-range or fractional durations are refused", () => {
    expect(issue({ durationSeconds: 86_401 })).not.toBeNull();
    expect(issue({ durationSeconds: -1 })).not.toBeNull();
    expect(issue({ durationSeconds: 1.5 })).not.toBeNull();
  });
});

describe("09.3 AC11 — keepRoutine needs a finish", () => {
  const ENDED = "2026-10-22T10:00:00Z";
  const errors = (b: Record<string, unknown>) => {
    const r = UpdateWorkoutSchema.safeParse(b);
    return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  };

  it.each([true, false])("keepRoutine: %j without a non-null endedAt is one issue on keepRoutine", (keepRoutine) => {
    for (const rest of [{}, { endedAt: null }, { title: "x" }]) {
      expect(errors({ ...rest, keepRoutine })).toEqual([{ path: "keepRoutine", message: REQUIRES_FINISH }]);
    }
  });

  it.each([true, false])("keepRoutine: %j with endedAt set is accepted", (keepRoutine) => {
    expect(UpdateWorkoutSchema.safeParse({ endedAt: ENDED, keepRoutine }).data).toEqual({ endedAt: ENDED, keepRoutine });
  });

  it("absent keepRoutine changes nothing", () => {
    for (const b of [{}, { endedAt: null }, { endedAt: ENDED }]) expect(UpdateWorkoutSchema.safeParse(b).success).toBe(true);
  });

  it("a non-boolean is rejected on keepRoutine", () => {
    expect(errors({ endedAt: ENDED, keepRoutine: "yes" }).map((e) => e.path)).toEqual(["keepRoutine"]);
  });

  it("the message is the static constant", () => {
    expect(REQUIRES_FINISH).toBe("requires endedAt");
  });
});
