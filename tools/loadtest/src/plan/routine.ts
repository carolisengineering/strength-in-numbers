import type { RoutineCreate } from "@sin/core";

/**
 * Spec 16 AC5 — the routine every load-test account is seeded with: five barbell lifts and pull-ups, 20 working
 * sets, bench and row as one superset. About 58 minutes at real pace (20 × (40 s + 135 s mean rest)).
 */
export const SEEDED_ROUTINE_NAME = "Load test — strength session";

export interface SeededItem {
  key: string;
  sets: number;
  /** Planned working weight; `null` for a bodyweight exercise (its sets carry no weight). */
  weightKg: number | null;
  supersetGroup?: number;
}

export const SEEDED_ITEMS: readonly SeededItem[] = [
  { key: "barbell-back-squat", sets: 4, weightKg: 100 },
  { key: "barbell-bench-press", sets: 4, weightKg: 70, supersetGroup: 1 },
  { key: "barbell-row", sets: 3, weightKg: 60, supersetGroup: 1 },
  { key: "overhead-press", sets: 3, weightKg: 40 },
  { key: "conventional-deadlift", sets: 3, weightKg: 120 },
  { key: "pull-up", sets: 3, weightKg: null },
];

export const SEEDED_ROUTINE_KEYS: readonly string[] = SEEDED_ITEMS.map((i) => i.key);

/** Planned set count per item, in routine order (what the session builder and the executor follow). */
export function seededRoutineSets(): number[] {
  return SEEDED_ITEMS.map((i) => i.sets);
}

/** The POST /v1/routines body, given the catalog's id for each key. */
export function seededRoutine(exerciseIdsByKey: Record<string, string>): RoutineCreate {
  return {
    name: SEEDED_ROUTINE_NAME,
    items: SEEDED_ITEMS.map((item) => {
      const exerciseId = exerciseIdsByKey[item.key];
      if (exerciseId === undefined) throw new Error(`catalog has no exercise "${item.key}"`);
      return {
        exerciseId: exerciseId as RoutineCreate["items"][number]["exerciseId"],
        ...(item.supersetGroup !== undefined ? { supersetGroup: item.supersetGroup } : {}),
        sets: Array.from({ length: item.sets }, () => ({
          setType: "working" as const,
          repsLow: 5,
          repsHigh: 8,
          ...(item.weightKg !== null ? { weight: item.weightKg, weightUnit: "kg" as const } : {}),
        })),
      };
    }),
  };
}
