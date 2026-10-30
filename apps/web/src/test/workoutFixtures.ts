import {
  PersonalRecordSchema,
  ProgressPointSchema,
  RoutineItemSchema,
  RoutineSchema,
  RoutineSectionSchema,
  SetEntrySchema,
  WorkoutDetailSchema,
  WorkoutSummarySchema,
  type Modality,
  type PersonalRecord,
  type PlannedSet,
  type ProgressPoint,
  type Routine,
  type RoutineItem,
  type RoutineSection,
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
    calories: null,
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
  /** Spec 20.2: the catalog exercise; minted when absent. */
  exerciseId?: string;
  modality: Modality;
  name?: string;
  sets?: SetEntry[];
  /** Spec 10.1: routine-derived fields; each defaults to null. */
  supersetGroup?: number | null;
  notes?: string | null;
  targetSets?: number | null;
  targetRepsLow?: number | null;
  targetRepsHigh?: number | null;
  targetRpe?: number | null;
  restSeconds?: number | null;
  /** Spec 10.2: the routine item's planned rows; each defaults to none. */
  plannedSets?: PlannedSet[];
  /** Spec 10.3: index into `WorkoutDetailOptions.sections`; omitted / null = loose. */
  sectionIndex?: number | null;
}

export interface WorkoutDetailOptions {
  id?: string;
  startedAt?: string;
  endedAt?: string | null;
  /** History rows show the date, so tests need distinct days (Spec 08.0). */
  localDate?: string;
  exercises?: ExerciseSpec[];
  routineName?: string | null;
  /** Spec 10.3: the workout's snapshotted sections (ids minted) and the routine note. */
  sections?: { name: string; notes?: string | null; addedInWorkout?: boolean }[];
  routineNotes?: string | null;
  /** Spec 18.0: the workout's own title and notes. */
  title?: string | null;
  notes?: string | null;
  /** Spec 18.0 Phase B: a live workout's "took" (Change Time) and the recorded offset. */
  plannedDurationSeconds?: number | null;
  tzOffsetMinutes?: number;
  /** Spec 10.5: the workout was started from a one-off routine. */
  routineIsOneOff?: boolean;
}

/** A `WorkoutDetail` parsed through the core schema; each set is re-parented to its exercise. */
export function makeWorkoutDetail(opts: WorkoutDetailOptions = {}): WorkoutDetail {
  const id = opts.id ?? nextId();
  const sections = (opts.sections ?? []).map((s, position) => ({ id: nextId(), position, name: s.name, notes: s.notes ?? null, addedInWorkout: s.addedInWorkout ?? false }));
  return WorkoutDetailSchema.parse({
    id,
    title: opts.title ?? null,
    notes: opts.notes ?? null,
    startedAt: opts.startedAt ?? T0,
    endedAt: opts.endedAt ?? null,
    localDate: opts.localDate ?? "2026-10-02",
    tzOffsetMinutes: opts.tzOffsetMinutes ?? 0,
    clientGeneratedId: nextId(),
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    routineName: opts.routineName ?? null,
    plannedDurationSeconds: opts.plannedDurationSeconds ?? null,
    routineNotes: opts.routineNotes ?? null,
    sections,
    routineIsOneOff: opts.routineIsOneOff ?? false,
    exercises: (opts.exercises ?? []).map((spec, position) => {
      const weId = spec.id ?? nextId();
      return {
        id: weId,
        workoutId: id,
        position,
        exerciseId: spec.exerciseId ?? nextId(),
        exerciseNameSnapshot: spec.name ?? `Exercise ${position + 1}`,
        modalitySnapshot: spec.modality,
        notes: spec.notes ?? null,
        createdAt: T0,
        updatedAt: T0,
        targetSets: spec.targetSets ?? null,
        targetRepsLow: spec.targetRepsLow ?? null,
        targetRepsHigh: spec.targetRepsHigh ?? null,
        targetRpe: spec.targetRpe ?? null,
        restSeconds: spec.restSeconds ?? null,
        supersetGroup: spec.supersetGroup ?? null,
        plannedSets: spec.plannedSets ?? [],
        sectionId: spec.sectionIndex == null ? null : sections[spec.sectionIndex]!.id,
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
    plannedDurationSeconds: null,
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
    maxCalories: null,
    maxDistance: null,
    maxDuration: null,
    ...overrides,
  });
}

/** A deterministic routine id: `…-000000000003` for `n = 3`. */
export const routineId = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A deterministic section id: `…-000000000002` for `n = 2` (prefix 6 so it never collides with ids minted by `nextId`). */
export const sectionId = (n: number): string => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function makeRoutineSection(overrides: Record<string, unknown> = {}): RoutineSection {
  return RoutineSectionSchema.parse({ id: sectionId(1), position: 0, name: "Warm-up", notes: null, ...overrides });
}

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
    sets: [],
    sectionId: null,
    ...overrides,
  });
}

/** A schema-valid routine; `items` defaults to one ungrouped item (exercise 1). */
export function makeRoutine(overrides: Record<string, unknown> = {}): Routine {
  return RoutineSchema.parse({
    id: routineId(1),
    name: "Push A",
    notes: null,
    sections: [],
    items: [makeRoutineItem()],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    oneOffUntil: null,
    ...overrides,
  });
}
