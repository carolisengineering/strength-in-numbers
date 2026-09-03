/**
 * Shared closed vocabularies, each as a frozen runtime array *and* a derived
 * union type. Values are the single source of truth — DESIGN.md §4.0–4.5. The
 * API (Zod schemas, Prisma enums) and the web app (`<select>` options) both
 * consume these so a value can only be added in one place.
 *
 * `Object.freeze([...] as const)` gives both a runtime-immutable array and a
 * literal tuple type, so `(typeof X_VALUES)[number]` narrows to the union and
 * `z.enum(X_VALUES)` type-checks.
 */

/** `user.unit_preference` — the user's *display* default (DESIGN §4.1). */
export const UNIT_PREFERENCE_VALUES = Object.freeze(["kg", "lb"] as const);
export type UnitPreference = (typeof UNIT_PREFERENCE_VALUES)[number];

/** The unit a specific set's weight was entered in (`set_entry.weight_unit`). */
export const WEIGHT_UNIT_VALUES = Object.freeze(["kg", "lb"] as const);
export type WeightUnit = (typeof WEIGHT_UNIT_VALUES)[number];

/** The unit a specific set's distance was entered in (`set_entry.distance_unit`). */
export const DISTANCE_UNIT_VALUES = Object.freeze(["m", "km", "mi"] as const);
export type DistanceUnit = (typeof DISTANCE_UNIT_VALUES)[number];

/**
 * How an exercise is measured (DESIGN §4.2). Which set measures are required is
 * validated per-modality in Spec 05 — this package only owns the vocabulary.
 */
export const MODALITY_VALUES = Object.freeze([
  "weight_reps",
  "bodyweight_reps",
  "weighted_bodyweight",
  "duration",
  "distance_duration",
] as const);
export type Modality = (typeof MODALITY_VALUES)[number];

/** `set_entry.set_type` (DESIGN §4.4). Only `working` sets count toward PRs. */
export const SET_TYPE_VALUES = Object.freeze([
  "warmup",
  "working",
  "drop",
  "failure",
] as const);
export type SetType = (typeof SET_TYPE_VALUES)[number];

/** `personal_record.record_type` — the three v1 PR kinds (DESIGN §4.5). */
export const RECORD_TYPE_VALUES = Object.freeze([
  "heaviest_weight",
  "best_est_1rm",
  "best_set_volume",
] as const);
export type RecordType = (typeof RECORD_TYPE_VALUES)[number];
