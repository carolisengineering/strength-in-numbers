// apps/web/src/features/routines/exerciseLookup.ts
import { useMemo } from "react";
import type { Exercise } from "@sin/core";
import { useCatalog } from "../catalog/useCatalog";

export type ExerciseState = "active" | "retired" | "unknown";

export interface ExerciseInfo {
  readonly name: string;
  readonly state: ExerciseState;
}

export const UNKNOWN_EXERCISE_NAME = "Exercise";

/**
 * Name + state of a routine item's exercise (Spec 10.0 AC30, D15). Reads the store's **raw** rows:
 * `useCatalog().visible` drops retired rows and fork origins (it is the picker's list), but a routine may
 * still name either, and a retired one must stay named so the lifter can remove it.
 */
export function lookupIn(rows: readonly Exercise[]): (id: string) => ExerciseInfo {
  const byId = new Map(rows.map((row) => [row.id as string, row]));
  return (id) => {
    const row = byId.get(id);
    if (!row) return { name: UNKNOWN_EXERCISE_NAME, state: "unknown" };
    return { name: row.name, state: row.isActive ? "active" : "retired" };
  };
}

export function useExerciseLookup(): (id: string) => ExerciseInfo {
  const { state } = useCatalog();
  return useMemo(() => lookupIn(state.rows), [state.rows]);
}
