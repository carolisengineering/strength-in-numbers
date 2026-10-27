import type { HevyMapping, HevyPair, Modality, SetEntry, WorkoutDetail, WorkoutExerciseDetail, WorkoutSection } from "../../../src/index.js";

/** Spec 19.0 Task 6: builders for the export and fingerprint tests. Ids are readable placeholders, not real rows. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const exerciseId = (n: number) => uuid(1000 + n);

let next = 1;
const nextId = () => uuid(next++);

export function set(o: Partial<SetEntry> = {}): SetEntry {
  return {
    id: nextId() as SetEntry["id"],
    workoutExerciseId: uuid(9) as SetEntry["workoutExerciseId"],
    clientGeneratedId: null,
    setNumber: 1,
    setType: "working",
    reps: 5,
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
    completedAt: "2026-10-01T10:10:00.000Z",
    createdAt: "2026-10-01T10:10:00.000Z",
    updatedAt: "2026-10-01T10:10:00.000Z",
    ...o,
  };
}

export function exercise(n: number, o: Partial<WorkoutExerciseDetail> = {}): WorkoutExerciseDetail {
  return {
    id: nextId() as WorkoutExerciseDetail["id"],
    workoutId: uuid(1) as WorkoutExerciseDetail["workoutId"],
    position: n,
    exerciseId: exerciseId(n) as WorkoutExerciseDetail["exerciseId"],
    exerciseNameSnapshot: `Exercise ${n}`,
    modalitySnapshot: "weight_reps" as Modality,
    notes: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetRpe: null,
    restSeconds: null,
    supersetGroup: null,
    plannedSets: [],
    sectionId: null,
    sets: [set()],
    ...o,
  };
}

export function section(n: number, name: string, o: Partial<WorkoutSection> = {}): WorkoutSection {
  return { id: uuid(500 + n) as WorkoutSection["id"], position: n, name, notes: null, addedInWorkout: false, ...o };
}

export function detail(o: Partial<WorkoutDetail> = {}): WorkoutDetail {
  return {
    id: uuid(1) as WorkoutDetail["id"],
    title: "Push",
    notes: null,
    startedAt: "2026-10-01T10:00:00.000-05:00",
    endedAt: "2026-10-01T11:00:00.000-05:00",
    localDate: "2026-10-01",
    tzOffsetMinutes: -300,
    clientGeneratedId: uuid(2),
    source: "manual",
    createdAt: "2026-10-01T15:00:00.000Z",
    updatedAt: "2026-10-01T16:00:00.000Z",
    routineName: null,
    plannedDurationSeconds: null,
    exercises: [],
    routineNotes: null,
    sections: [],
    routineIsOneOff: false,
    ...o,
  };
}

export function pair(o: Partial<HevyPair> = {}): HevyPair {
  return {
    hevyTemplateId: "T1",
    hevyTitle: "Bench Press (Barbell)",
    hevyType: "weight_reps",
    role: "exercise",
    exerciseId: exerciseId(0),
    exerciseActive: true,
    measureRule: null,
    exportAs: true,
    ...o,
  };
}

/** Every exercise 0…n-1 paired as weight_reps, plus both placeholders. */
export function mappingFor(count: number, o: { placeholders?: boolean } = {}): HevyMapping {
  const pairs = Array.from({ length: count }, (_, i) => pair({ hevyTemplateId: `T${i}`, hevyTitle: `Hevy ${i}`, exerciseId: exerciseId(i) }));
  if (o.placeholders !== false) {
    pairs.push(pair({ hevyTemplateId: "WARM", hevyTitle: "Warmup", hevyType: "reps_only", role: "warmup_placeholder", exerciseId: null, exerciseActive: null, exportAs: false }));
    pairs.push(pair({ hevyTemplateId: "WORK", hevyTitle: "Workout", hevyType: "reps_only", role: "workout_placeholder", exerciseId: null, exerciseActive: null, exportAs: false }));
  }
  return { pairs, sectionRules: [] };
}

/** Lineage roots are the ids themselves unless a test says otherwise. */
export const identityRoot = (id: string) => id;
