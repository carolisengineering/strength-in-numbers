import {
  MODALITY_VALUES,
  canChangeModality,
  compatibleModalities,
  type Exercise,
  type Modality,
  type UpdateExercise,
} from "@sin/core";

import type { ExerciseFieldValues } from "../catalog/ExerciseFields";
import { MODALITY_LABELS } from "../catalog/labels";
import { EXERCISES_COPY } from "./messages";

/** The Edit sheet's starting values (Spec 18.2 §6.5): null ids become "" (the selects' "none"). */
export function valuesFromExercise(row: Exercise): ExerciseFieldValues {
  return {
    name: row.name,
    modality: row.modality,
    primaryMuscleId: row.primaryMuscleId ?? "",
    secondaryMuscleIds: [...row.secondaryMuscleIds],
    equipmentId: row.equipmentId ?? "",
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const orNull = (id: string) => (id === "" ? null : id);

/**
 * The `PATCH` body (AC36): only what changed, so a rename never carries the type (which a logged exercise's
 * server would refuse) and `{}` means nothing to save (Save stays disabled; `PATCH {}` is never sent).
 */
export function toUpdateExerciseInput(initial: ExerciseFieldValues, current: ExerciseFieldValues): UpdateExercise {
  const patch: UpdateExercise = {};
  if (current.name.trim() !== initial.name.trim()) patch.name = current.name.trim();
  if (current.modality !== null && current.modality !== initial.modality) patch.modality = current.modality;
  if (current.primaryMuscleId !== initial.primaryMuscleId) patch.primaryMuscleId = orNull(current.primaryMuscleId);
  if (!sameSet(current.secondaryMuscleIds, initial.secondaryMuscleIds)) patch.secondaryMuscleIds = [...current.secondaryMuscleIds];
  if (current.equipmentId !== initial.equipmentId) patch.equipmentId = orNull(current.equipmentId);
  return patch;
}

/** What the sheet knows about the exercise's logged sets (AC37, AC38). */
export type UsageKnowledge = { status: "pending" } | { status: "failed" } | { status: "known"; hasLoggedSets: boolean };

/** The type choices to disable (AC37): the 03.4 rule when usage is known, else every type but the current one (AC38). */
export function disabledModalitiesFor(current: Modality, usage: UsageKnowledge): ReadonlySet<Modality> {
  if (usage.status !== "known") return new Set(MODALITY_VALUES.filter((v) => v !== current));
  return new Set(MODALITY_VALUES.filter((to) => !canChangeModality({ from: current, to, hasLoggedSets: usage.hasLoggedSets })));
}

const WEIGHTED = new Set<Modality>(["weight_reps", "weighted_bodyweight"]);

/** The notes under the type choices, in AC37–AC39 order. */
export function modalityNotes(current: Modality, selected: Modality, usage: UsageKnowledge): string[] {
  if (usage.status === "pending") return [EXERCISES_COPY.typeChecking];
  if (usage.status === "failed") return [EXERCISES_COPY.typeCheckFailed];
  if (!usage.hasLoggedSets) return [];
  const partners = compatibleModalities(current)
    .filter((v) => v !== current)
    .map((v) => MODALITY_LABELS[v]);
  const notes = [partners.length > 0 ? EXERCISES_COPY.typeLimitedTo(partners.join(" or ")) : EXERCISES_COPY.typeFixed];
  if (selected !== current && WEIGHTED.has(current) && WEIGHTED.has(selected)) notes.push(EXERCISES_COPY.weightMeaning);
  return notes;
}
