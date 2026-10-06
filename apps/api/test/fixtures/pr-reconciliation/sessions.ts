/**
 * Spec 07.0 AC26 — ten sessions for the hand reconciliation, listed in
 * ARRIVAL order. `day` is the September 2026 start date: S4 is backdated (it
 * arrives fourth but started on day 2). Covers a fork, an lb entry, a heavier
 * warm-up and failure set that must not count, a 13-rep set (no e1RM), ties
 * within and across workouts, and all four record types.
 */
import type { SetSpec } from "../../integration/records-helpers.js";

export type ExerciseKey = "bench" | "benchFork" | "squat" | "dips" | "pullup";

export const EXERCISES: Record<ExerciseKey, { modality: string; forkOf?: ExerciseKey }> = {
  bench: { modality: "weight_reps" },
  benchFork: { modality: "weight_reps", forkOf: "bench" },
  squat: { modality: "weight_reps" },
  dips: { modality: "weighted_bodyweight" },
  pullup: { modality: "bodyweight_reps" },
};

export interface Session {
  id: string;
  day: number;
  exercises: { key: ExerciseKey; sets: SetSpec[] }[];
}

export const SESSIONS: Session[] = [
  {
    id: "S1",
    day: 1,
    exercises: [
      { key: "bench", sets: [{ setType: "warmup", reps: 3, weight: 140 }, { reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
      { key: "squat", sets: [{ reps: 5, weight: 225, weightUnit: "lb" }] },
    ],
  },
  {
    id: "S2",
    day: 3,
    exercises: [
      { key: "bench", sets: [{ reps: 3, weight: 102.5 }] },
      { key: "pullup", sets: [{ reps: 8 }, { reps: 10 }] },
    ],
  },
  {
    id: "S3",
    day: 5,
    exercises: [
      { key: "benchFork", sets: [{ reps: 5, weight: 102.5 }] },
      { key: "dips", sets: [{ reps: 8, weight: 20 }] },
    ],
  },
  {
    id: "S4", // backdated: arrives 4th, sorts 2nd
    day: 2,
    exercises: [
      { key: "bench", sets: [{ reps: 1, weight: 105 }] },
      { key: "squat", sets: [{ reps: 8, weight: 100 }] },
    ],
  },
  {
    id: "S5",
    day: 7,
    exercises: [
      { key: "squat", sets: [{ reps: 13, weight: 110 }] },
      { key: "dips", sets: [{ reps: 5, weight: 25 }] },
    ],
  },
  {
    id: "S6",
    day: 8,
    exercises: [
      { key: "pullup", sets: [{ reps: 12 }] },
      { key: "bench", sets: [{ setType: "failure", reps: 1, weight: 120 }] },
    ],
  },
  { id: "S7", day: 9, exercises: [{ key: "benchFork", sets: [{ reps: 8, weight: 100 }] }] },
  { id: "S8", day: 10, exercises: [{ key: "dips", sets: [{ reps: 10, weight: 20 }] }] },
  { id: "S9", day: 11, exercises: [{ key: "squat", sets: [{ reps: 10, weight: 105 }] }] },
  {
    id: "S10",
    day: 12,
    exercises: [
      { key: "pullup", sets: [{ reps: 12 }] },
      { key: "bench", sets: [{ reps: 5, weight: 102.5 }] },
    ],
  },
];
