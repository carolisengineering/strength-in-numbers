import {
  SetEntrySchema,
  WorkoutDetailSchema,
  type Modality,
  type SetEntry,
  type WorkoutDetail,
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
    localDate: "2026-10-02",
    tzOffsetMinutes: 0,
    clientGeneratedId: nextId(),
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
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
        sets: (spec.sets ?? []).map((s) => ({ ...s, workoutExerciseId: weId })),
      };
    }),
  });
}
