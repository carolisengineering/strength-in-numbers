/**
 * Spec 09.1 §6.2 — the one place an item's rows and its derived target columns
 * are decided (AC8). The Prisma repository and the test fake both call
 * `resolveItemPlan`, so the derived columns are never hand-assigned.
 */
import { Prisma } from "@prisma/client";
import {
  deriveTargets,
  expandQuickLine,
  normalizePlannedSet,
  plannedSetViolations,
  type Modality,
  type PlannedSet,
  type SetType,
  type WeightUnit,
} from "@sin/core";
import { ValidationError, type FieldError } from "../errors/app-error.js";
import type { RoutineWriteFields } from "./routine.js";

type ItemFields = RoutineWriteFields["items"][number];

export interface ItemPlan {
  rows: PlannedSet[];
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
}

export function resolveItemPlan(item: ItemFields): ItemPlan {
  if (item.sets !== undefined) {
    const rows = item.sets.map(normalizePlannedSet);
    return { rows, ...deriveTargets(rows) };
  }
  const rows = expandQuickLine(item);
  if (rows.length > 0) return { rows, ...deriveTargets(rows) };
  // O1 (owner, 2026-10-11): a rep range with no set count keeps no rows and its range as sent.
  return { rows: [], targetSets: null, targetRepsLow: item.targetRepsLow ?? null, targetRepsHigh: item.targetRepsHigh ?? null };
}

/** AC5 — row form only (D5): legacy input is exempt. One 422 for every violation. */
export function assertPlannedSetsFitModalities(
  items: readonly ItemFields[],
  modalityOf: ReadonlyMap<string, Modality>,
): void {
  const errors: FieldError[] = [];
  items.forEach((it, i) => {
    if (it.sets === undefined) return;
    const modality = modalityOf.get(it.exerciseId);
    if (modality === undefined) return; // absent exercises were already refused (422)
    for (const v of plannedSetViolations(modality, it.sets)) {
      errors.push({ path: `items.${i}.sets.${v.row}.${v.field}`, message: v.message });
    }
  });
  if (errors.length > 0) throw new ValidationError(errors, "planned set carries a measure its exercise type cannot use");
}

/** A row as `json_build_object` emits it (snake_case; weight as float8). */
export interface PlannedSetDbRow {
  set_type: string;
  reps_low: number | null;
  reps_high: number | null;
  weight: number | null;
  weight_unit: string | null;
}

export function toPlannedSet(r: PlannedSetDbRow): PlannedSet {
  return {
    setType: r.set_type as SetType,
    repsLow: r.reps_low,
    repsHigh: r.reps_high,
    weight: r.weight,
    weightUnit: r.weight_unit as WeightUnit | null,
  };
}

/** `COALESCE(json_agg(row ORDER BY position), '[]')` of one parent's planned
 * sets, as a scalar subquery — keeps every read a single statement (AC2). */
export function plannedSetsJson(
  table: "routine_item_set" | "workout_planned_set",
  fkColumn: "routine_item_id" | "workout_exercise_id",
  parentRef: string,
): Prisma.Sql {
  return Prisma.raw(`COALESCE((
    SELECT json_agg(json_build_object(
             'set_type', ps.set_type, 'reps_low', ps.reps_low, 'reps_high', ps.reps_high,
             'weight', ps.weight::float8, 'weight_unit', ps.weight_unit)
           ORDER BY ps.position)
    FROM "${table}" ps WHERE ps.${fkColumn} = ${parentRef}
  ), '[]'::json)`);
}
