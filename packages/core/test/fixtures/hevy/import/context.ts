import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HevyImportContext,
  HevyImportExercise,
  HevyImportSetInput,
  HevyImportWorkout,
  HevyPair,
  HevyType,
  ImportExerciseInfo,
  MeasureRule,
  Modality,
  PairRole,
  UnitPreference,
} from "../../../../src/index.js";

/** Spec 19.1 Phase A test catalog: one Hevy template id per case, its pair and its SIN exercise. */
const DIR = dirname(fileURLToPath(import.meta.url));

export const sinId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Entry {
  hevyType: HevyType | null;
  role: PairRole;
  rule?: MeasureRule | null;
  sin?: { n: number; name: string; modality: Modality; active?: boolean; rootN?: number; absent?: boolean };
}

export const CATALOG: Readonly<Record<string, Entry>> = {
  BENCH: { hevyType: "weight_reps", role: "exercise", sin: { n: 1, name: "Bench Press", modality: "weight_reps" } },
  SQUAT: { hevyType: "weight_reps", role: "exercise", sin: { n: 2, name: "Back Squat", modality: "weight_reps" } },
  ROW: { hevyType: "weight_reps", role: "exercise", sin: { n: 3, name: "Barbell Row", modality: "weight_reps" } },
  PULLUP: { hevyType: "reps_only", role: "exercise", sin: { n: 4, name: "Pull Up", modality: "bodyweight_reps" } },
  ECHO: { hevyType: "reps_only", role: "exercise", rule: "calories_as_reps", sin: { n: 5, name: "Echo Bike", modality: "calories" } },
  CARRY: { hevyType: "short_distance_weight", role: "exercise", sin: { n: 6, name: "Farmer Carry", modality: "weight_distance" } },
  ASSIST: {
    hevyType: "bodyweight_assisted_reps",
    role: "exercise",
    rule: "assist_weight_ignored",
    sin: { n: 7, name: "Assisted Dip", modality: "bodyweight_reps" },
  },
  RUN: { hevyType: "distance_duration", role: "exercise", sin: { n: 8, name: "Run", modality: "distance_duration" } },
  PLANK: { hevyType: "duration", role: "exercise", sin: { n: 9, name: "Plank", modality: "duration" } },
  SLED: { hevyType: "weight_duration", role: "exercise", sin: { n: 10, name: "Sled Hold", modality: "weight_duration" } },
  DIPW: { hevyType: "bodyweight_reps", role: "exercise", sin: { n: 11, name: "Weighted Dip", modality: "weighted_bodyweight" } },
  BENCH_FORK: { hevyType: "weight_reps", role: "exercise", sin: { n: 12, name: "My Bench", modality: "weight_reps", rootN: 1 } },
  RETIRED: { hevyType: "weight_reps", role: "exercise", sin: { n: 13, name: "Old Press", modality: "weight_reps", active: false } },
  ORPHAN: { hevyType: "weight_reps", role: "exercise", sin: { n: 14, name: "Gone", modality: "weight_reps", absent: true } },
  WARMUP: { hevyType: "reps_only", role: "warmup_placeholder" },
  WORKOUT: { hevyType: "reps_only", role: "workout_placeholder" },
  SKIP: { hevyType: "weight_reps", role: "skip" },
};

export function importContext(unit: UnitPreference = "kg", now = new Date("2026-10-28T12:00:00.000Z")): HevyImportContext {
  const pairs = new Map<string, HevyPair>();
  const exercises = new Map<string, ImportExerciseInfo>();
  for (const [id, e] of Object.entries(CATALOG)) {
    pairs.set(id, {
      hevyTemplateId: id,
      hevyTitle: e.sin?.name ?? id,
      hevyType: e.hevyType,
      role: e.role,
      exerciseId: e.sin ? sinId(e.sin.n) : null,
      exerciseActive: e.sin ? (e.sin.active ?? true) : null,
      measureRule: e.rule ?? null,
      exportAs: false,
    });
    if (e.sin && !e.sin.absent) {
      exercises.set(sinId(e.sin.n), {
        name: e.sin.name,
        modality: e.sin.modality,
        active: e.sin.active ?? true,
        rootId: sinId(e.sin.rootN ?? e.sin.n),
      });
    }
  }
  return { pairs, exercises, unit, now };
}

const NULL_SET: HevyImportSetInput = {
  type: "normal",
  weightKg: null,
  reps: null,
  distanceMeters: null,
  durationSeconds: null,
  rpe: null,
  customMetric: null,
};

export const hset = (o: Partial<HevyImportSetInput> = {}): HevyImportSetInput => ({ ...NULL_SET, ...o });

export const hex = (exerciseTemplateId: string, sets: HevyImportSetInput[], o: Partial<HevyImportExercise> = {}): HevyImportExercise => ({
  exerciseTemplateId,
  notes: null,
  supersetId: null,
  sets,
  ...o,
});

export const hworkout = (exercises: HevyImportExercise[], o: Partial<HevyImportWorkout> = {}): HevyImportWorkout => ({
  hevyWorkoutId: "hevy-1",
  title: "Push Day",
  description: null,
  startTime: "2026-10-01T10:00:00Z",
  endTime: "2026-10-01T11:00:00Z",
  tzOffsetMinutes: 0,
  exercises,
  ...o,
});

export function fixture(name: string): HevyImportWorkout {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as HevyImportWorkout;
}

export function jsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as T;
}
