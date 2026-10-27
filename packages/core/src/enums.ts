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
export const DISTANCE_UNIT_VALUES = Object.freeze(["m", "km", "mi", "ft"] as const);
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
  "calories",
  "weight_distance",
  "weight_duration",
] as const);
export type Modality = (typeof MODALITY_VALUES)[number];

/** `workout.source` (DESIGN §6). `hevy` (Spec 19.0 AC2) ships a release before anything writes it, so every
 * web bundle knows the value first; migration `0016` widens the CHECK. A future importer (`healthkit`, …) adds
 * its own value the same way (widening a CHECK literal list is additive, 03.1's precedent). */
export const WORKOUT_SOURCE_VALUES = Object.freeze(["manual", "hevy"] as const);
export type WorkoutSource = (typeof WORKOUT_SOURCE_VALUES)[number];

/** `set_entry.set_type` (DESIGN §4.4). Only `working` sets count toward PRs. */
export const SET_TYPE_VALUES = Object.freeze([
  "warmup",
  "working",
  "drop",
  "failure",
] as const);
export type SetType = (typeof SET_TYPE_VALUES)[number];

/** `personal_record.record_type` — the four v1 PR kinds (DESIGN §4.5, Spec 07.0 D2),
 * then the Spec 05.3 D7 kinds for the new types. */
export const RECORD_TYPE_VALUES = Object.freeze([
  "heaviest_weight",
  "best_est_1rm",
  "best_set_volume",
  "max_reps",
  "max_calories",
  "max_distance",
  "max_duration",
] as const);
export type RecordType = (typeof RECORD_TYPE_VALUES)[number];

/** `personal_record.unit` — canonical units only (DESIGN §4.8). `kg_reps` is
 * a set volume (reps × kg); `cal` a calorie count, `m` meters, `s` seconds. */
export const RECORD_UNIT_VALUES = Object.freeze(["kg", "kg_reps", "reps", "cal", "m", "s"] as const);
export type RecordUnit = (typeof RECORD_UNIT_VALUES)[number];

/** The one legal unit per record type — the migration's type↔unit CHECK is
 * rendered from this (Spec 07.0 §4, D17). */
export const RECORD_UNIT_BY_TYPE: Readonly<Record<RecordType, RecordUnit>> = Object.freeze({
  heaviest_weight: "kg",
  best_est_1rm: "kg",
  best_set_volume: "kg_reps",
  max_reps: "reps",
  max_calories: "cal",
  max_distance: "m",
  max_duration: "s",
});
