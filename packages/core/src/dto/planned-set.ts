/**
 * Spec 09.1 §5 — one planned set of a routine item (and its snapshot on a
 * workout exercise). No id and no position on the wire: array order is the
 * order (D14). Weight is stored as typed with its unit (DESIGN §4.8, D3).
 */
import { z } from "zod";
import { SET_TYPE_VALUES, WEIGHT_UNIT_VALUES } from "../enums.js";
import { SET_WEIGHT_MAX } from "./set-entry.js";

/** ≤ 20 rows per item (D4): matches the `targetSets` ceiling. */
export const PLANNED_SETS_PER_ITEM_MAX = 20;

/** One row in a POST/PUT body. Pair rules live in RoutineWriteSchema's superRefine. */
export const PlannedSetInputSchema = z.strictObject({
  setType: z.enum(SET_TYPE_VALUES).optional(),
  repsLow: z.number().int().min(1).max(100).nullable().optional(),
  repsHigh: z.number().int().min(1).max(100).nullable().optional(),
  weight: z.number().nonnegative().max(SET_WEIGHT_MAX).nullable().optional(),
  weightUnit: z.enum(WEIGHT_UNIT_VALUES).nullable().optional(),
});
export type PlannedSetInput = z.infer<typeof PlannedSetInputSchema>;

/** Response row: every field present. */
export const PlannedSetSchema = z.object({
  setType: z.enum(SET_TYPE_VALUES),
  repsLow: z.number().int().nullable(),
  repsHigh: z.number().int().nullable(),
  weight: z.number().nullable(),
  weightUnit: z.enum(WEIGHT_UNIT_VALUES).nullable(),
});
export type PlannedSet = z.infer<typeof PlannedSetSchema>;
