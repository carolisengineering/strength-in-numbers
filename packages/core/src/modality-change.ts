/**
 * Spec 03.4 §6.1 — when an exercise's type may change. Pure, shared by the API and the UI.
 * Two types are compatible when they log the same measures: equal required sets and equal forbidden sets (order
 * ignored). Comparing both keeps a future optional measure from slipping through.
 */
import { forbiddenMeasuresFor, requiredMeasuresFor } from "./dto/set-entry.js";
import { MODALITY_VALUES, type Modality } from "./enums.js";

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export function modalitiesCompatible(a: Modality, b: Modality): boolean {
  return sameSet(requiredMeasuresFor(a), requiredMeasuresFor(b)) && sameSet(forbiddenMeasuresFor(a), forbiddenMeasuresFor(b));
}

/** `m` and its partners, in `MODALITY_VALUES` order: the types a logged exercise may still switch to. */
export function compatibleModalities(m: Modality): readonly Modality[] {
  return MODALITY_VALUES.filter((other) => modalitiesCompatible(m, other));
}

/** Any type while nothing is logged; afterwards only one that logs the same measures. */
export function canChangeModality(i: { from: Modality; to: Modality; hasLoggedSets: boolean }): boolean {
  return i.from === i.to || !i.hasLoggedSets || modalitiesCompatible(i.from, i.to);
}

/** The one TypeScript statement of SQL's `COALESCE(forked_from_exercise_id, id)`. */
export function lineageRootId(e: { id: string; forkedFromExerciseId: string | null }): string {
  return e.forkedFromExerciseId ?? e.id;
}
