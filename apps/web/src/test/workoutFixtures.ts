import {
  PersonalRecordSchema,
  ProgressPointSchema,
  RoutineItemSchema,
  RoutineSchema,
  SetEntrySchema,
  WorkoutDetailSchema,
  WorkoutSummarySchema,
  type Modality,
  type PersonalRecord,
  type ProgressPoint,
  type Routine,
  type RoutineItem,
  type SetEntry,
  type WorkoutDetail,
  type WorkoutSummary,
} from "@sin/core";

let counter = 0;
const nextId = (): string => `10000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const T0 = "2026-10-02T10:00:00.000Z";

/** A complete `weight_reps` set (60 kg × 8) unless overridden. Validated through the core schema. */
export function makeSet(overrides: Record<string, unknown> = {}): SetEntry {
  return SetEntrySchema.parse({
    id: nextId(),
    workoutExerciseId: "20000000-0000-4000-8000-000000000001",
    clientGeneratedId: null,
    setNumber: 1,
    setType: "working",
    reps: 8,
    weight: 60,
    weightUnit: "kg",
    weightKg: 60,
    distance: null,
    distanceUnit: null,
    distanceM: null,
    durationS: null,
    rpe: null,
    isComplete: true,
    completedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

export interface ExerciseSpec {
  id?: string;
  modality: Modality;
  name?: string;
  sets?: SetEntry[];
}

export interface WorkoutDetailOptions {
  id?: string;
  startedAt?: string;
  endedAt?: string | null;
  /** History rows show the date, so tests need distinct days (Spec 08.0). */
  localDate?: string;
  exercises?: ExerciseSpec[];
}

/** A `WorkoutDetail` parsed through the core schema; each set is re-parented to its exercise. */
export function makeWorkoutDetail(opts: WorkoutDetailOptions = {}): WorkoutDetail {
  const id = opts.id ?? nextId();
  return WorkoutDetailSchema.parse({
    id,
    title: null,
    notes: null,
    startedAt: opts.startedAt ?? T0,
    endedAt: opts.endedAt ?? null,
    localDate: opts.localDate ?? "2026-10-02",
    tzOffsetMinutes: 0,
    clientGeneratedId: nextId(),
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    routineName: null,
    exercises: (opts.exercises ?? []).map((spec, position) => {
      const weId = spec.id ?? nextId();
      return {
        id: weId,
        workoutId: id,
        position,
        exerciseId: nextId(),
        exerciseNameSnapshot: spec.name ?? `Exercise ${position + 1}`,
        modalitySnapshot: spec.modality,
        notes: null,
        createdAt: T0,
        updatedAt: T0,
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetRpe: null,
        restSeconds: null,
        supersetGroup: null,
        sets: (spec.sets ?? []).map((s) => ({ ...s, workoutExerciseId: weId })),
      };
    }),
  });
}

/** A `WorkoutSummary` (a History row, Spec 07.1) parsed through the core schema. */
export function makeWorkoutSummary(overrides: Record<string, unknown> = {}): WorkoutSummary {
  return WorkoutSummarySchema.parse({
    id: nextId(),
    title: null,
    notes: null,
    startedAt: T0,
    endedAt: "2026-10-02T11:00:00.000Z",
    localDate: "2026-10-02",
    tzOffsetMinutes: 0,
    clientGeneratedId: nextId(),
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    routineName: null,
    exerciseCount: 1,
    exerciseNames: ["Bench Press"],
    workingSetCount: 3,
    totalVolume: 1500,
    recordCount: 0,
    ...overrides,
  });
}

/** A `PersonalRecord` (Spec 07.0) parsed through the core schema: Bench Press heaviest weight 102.5 kg, was 100. */
export function makePersonalRecord(overrides: Record<string, unknown> = {}): PersonalRecord {
  const exerciseId = nextId();
  return PersonalRecordSchema.parse({
    exerciseId,
    sourceExerciseId: exerciseId,
    exerciseName: "Bench Press",
    recordType: "heaviest_weight",
    value: 102.5,
    unit: "kg",
    previousValue: 100,
    sourceSetId: nextId(),
    workoutId: nextId(),
    achievedAt: T0,
    localDate: "2026-10-02",
    ...overrides,
  });
}

/** A `ProgressPoint` (Spec 07.2) parsed through the core schema: 100 kg × 5 on 2 Oct, no reps metric. */
export function makeProgressPoint(overrides: Record<string, unknown> = {}): ProgressPoint {
  return ProgressPointSchema.parse({
    workoutId: nextId(),
    localDate: "2026-10-02",
    startedAt: T0,
    topSetWeight: 100,
    bestE1rm: 116.667,
    totalVolume: 500,
    maxReps: null,
    ...overrides,
  });
}

/** A deterministic routine id: `…-000000000003` for `n = 3`. */
export const routineId = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function makeRoutineItem(overrides: Record<string, unknown> = {}): RoutineItem {
  return RoutineItemSchema.parse({
    id: crypto.randomUUID(),
    position: 0,
    exerciseId: "00000000-0000-4000-8000-000000000001",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetRpe: null,
    restSeconds: null,
    supersetGroup: null,
    notes: null,
    ...overrides,
  });
}

/** A schema-valid routine; `items` defaults to one ungrouped item (exercise 1). */
export function makeRoutine(overrides: Record<string, unknown> = {}): Routine {
  return RoutineSchema.parse({
    id: routineId(1),
    name: "Push A",
    notes: null,
    items: [makeRoutineItem()],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  });
}
