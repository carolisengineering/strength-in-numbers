import { useMemo } from "react";
import type { Exercise, Modality } from "@sin/core";
import { useCatalog } from "../catalog/useCatalog";

/**
 * `missing`: the catalog has synced this session and does not hold the id. Sync drops retired rows and
 * deleted custom exercises (06.0 `mergeCatalogRows`), so this is how a retired exercise usually looks.
 * `unknown`: absent before any sync — the store may simply not have it yet.
 */
export type ExerciseState = "active" | "retired" | "missing" | "unknown";

export interface ExerciseInfo {
  readonly name: string;
  readonly state: ExerciseState;
  /** Spec 10.2 AC9: what the plan may carry; `null` when the catalog does not hold the exercise. */
  readonly modality: Modality | null;
}

export const UNKNOWN_EXERCISE_NAME = "Exercise";
export const REMOVED_EXERCISE_NAME = "Removed exercise";

/**
 * Name + state of a routine item's exercise (Spec 10.0 AC30, D15). Reads the store's **raw** rows:
 * `useCatalog().visible` drops fork origins (it is the picker's list), but a routine may still name one.
 */
export function lookupIn(rows: readonly Exercise[], options: { synced: boolean }): (id: string) => ExerciseInfo {
  const byId = new Map(rows.map((row) => [row.id as string, row]));
  return (id) => {
    const row = byId.get(id);
    if (!row) {
      return options.synced
        ? { name: REMOVED_EXERCISE_NAME, state: "missing", modality: null }
        : { name: UNKNOWN_EXERCISE_NAME, state: "unknown", modality: null };
    }
    return { name: row.name, state: row.isActive ? "active" : "retired", modality: row.modality };
  };
}

export function useExerciseLookup(): (id: string) => ExerciseInfo {
  const { state } = useCatalog();
  const synced = state.lastRefreshAt !== null;
  return useMemo(() => lookupIn(state.rows, { synced }), [state.rows, synced]);
}
