import type { Equipment, Exercise, MuscleGroup } from "@sin/core";

import { MODALITY_LABELS } from "../catalog/labels";
import { EXERCISES_COPY } from "./messages";

export type RefState<T> = { status: "pending" } | { status: "error" } | { status: "ok"; rows: readonly T[] };

/** One row of the details block; `value: null` is omitted while its reference list loads. */
export interface DetailRow {
  label: string;
  value: string | null;
}

/**
 * Names for `ids` from a reference list (AC21): "Not set" when there are none, `null` while the list
 * loads, "Unavailable" when it failed or does not know one of the ids (a stale cache or a removed seed
 * row; never a raw id).
 */
function names(ids: readonly string[], ref: RefState<{ id: string; name: string }>): string | null {
  if (ids.length === 0) return EXERCISES_COPY.notSet;
  if (ref.status === "pending") return null;
  if (ref.status === "error") return EXERCISES_COPY.unavailable;
  const byId = new Map(ref.rows.map((r) => [r.id, r.name]));
  const found = ids.map((id) => byId.get(id));
  return found.every((n): n is string => n !== undefined) ? found.join(", ") : EXERCISES_COPY.unavailable;
}

const one = (id: string | null): string[] => (id === null ? [] : [id]);

/** The exercise page's details block (Spec 18.2 AC21), kept pure so every state is tested without React. */
export function detailRows(
  row: Exercise,
  ctx: { muscles: RefState<MuscleGroup>; equipment: RefState<Equipment>; origin: Exercise | null },
): DetailRow[] {
  const source =
    row.ownerUserId === null
      ? EXERCISES_COPY.builtInSource
      : row.forkedFromExerciseId === null
        ? EXERCISES_COPY.yourSource
        : ctx.origin
          ? EXERCISES_COPY.copyOf(ctx.origin.name)
          : EXERCISES_COPY.copyOfUnknown;
  return [
    { label: EXERCISES_COPY.source, value: source },
    { label: EXERCISES_COPY.type, value: MODALITY_LABELS[row.modality] },
    { label: EXERCISES_COPY.primaryMuscle, value: names(one(row.primaryMuscleId), ctx.muscles) },
    { label: EXERCISES_COPY.secondaryMuscles, value: names(row.secondaryMuscleIds, ctx.muscles) },
    { label: EXERCISES_COPY.equipment, value: names(one(row.equipmentId), ctx.equipment) },
  ];
}
