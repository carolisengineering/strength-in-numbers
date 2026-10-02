/**
 * Set-logging DTOs and per-modality measure rules (Spec 05.1 §5, §6.1). Same
 * conventions as `dto/workout.ts`: response schemas are `z.object` (field
 * allowlist), request bodies `z.strictObject` (unknown key -> 422).
 *
 * This module imports nothing from `dto/workout.ts`. `WorkoutExerciseDetailSchema`
 * lives there instead (Spec 05.1 D12), so the two modules can't form a cycle.
 */
import { z } from "zod";
import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, WEIGHT_UNIT_VALUES, type Modality } from "../enums.js";
import { SetEntryIdSchema, WorkoutExerciseIdSchema } from "../ids.js";

/** The four modality-governed measures. `rpe` is optional on every modality. */
export const MEASURE_NAMES = Object.freeze(["reps", "weight", "distance", "durationS"] as const);
export type MeasureName = (typeof MEASURE_NAMES)[number];

/** §6.1's table, as data. Order matters only for stable error-field ordering. */
const MEASURE_RULES: Record<Modality, { required: readonly MeasureName[]; forbidden: readonly MeasureName[] }> = {
  weight_reps: { required: ["weight", "reps"], forbidden: ["durationS", "distance"] },
  bodyweight_reps: { required: ["reps"], forbidden: ["weight", "durationS", "distance"] },
  weighted_bodyweight: { required: ["reps", "weight"], forbidden: ["durationS", "distance"] },
  duration: { required: ["durationS"], forbidden: ["weight", "reps", "distance"] },
  distance_duration: { required: ["distance", "durationS"], forbidden: ["weight", "reps"] },
};

export const requiredMeasuresFor = (m: Modality): readonly MeasureName[] => MEASURE_RULES[m].required;
export const forbiddenMeasuresFor = (m: Modality): readonly MeasureName[] => MEASURE_RULES[m].forbidden;

/**
 * Upper bounds at the `set_entry` column limits (Spec 05.1 D11), so an
 * out-of-range value is a 422 here rather than a numeric-overflow 500 from
 * Postgres. `distance` is further bounded after unit conversion by the API,
 * since `distance_m` shares `numeric(9,3)`.
 */
export const SET_REPS_MAX = 32_767; // smallint
export const SET_WEIGHT_MAX = 9_999.999; // numeric(7,3)
export const SET_DISTANCE_MAX = 999_999.999; // numeric(9,3)
export const SET_DURATION_S_MAX = 2_147_483_647; // integer

const Reps = z.number().int().min(0).max(SET_REPS_MAX);
const Weight = z.number().nonnegative().max(SET_WEIGHT_MAX);
const Distance = z.number().nonnegative().max(SET_DISTANCE_MAX);
const DurationS = z.number().int().nonnegative().max(SET_DURATION_S_MAX);
// RPE bounds: DESIGN glossary "1-10"; numeric(3,1) holds one decimal.
const Rpe = z.number().min(1).max(10).multipleOf(0.1);

/**
 * One logged set. `weightKg` / `distanceM` are generated columns, read-only.
 * `rpe` is a plain nullable number here, not `Rpe`: a response schema is an
 * allowlist, and a `multipleOf` on a value read back through `::float8` could
 * spuriously fail serialization. `clientGeneratedId` echoes the create's
 * idempotency key; `null` for a set created without one (D15).
 */
export const SetEntrySchema = z.object({
  id: SetEntryIdSchema,
  workoutExerciseId: WorkoutExerciseIdSchema,
  clientGeneratedId: z.guid().nullable(),
  setNumber: z.number().int().min(1),
  setType: z.enum(SET_TYPE_VALUES),
  reps: z.number().int().min(0).nullable(),
  weight: z.number().nonnegative().nullable(),
  weightUnit: z.enum(WEIGHT_UNIT_VALUES).nullable(),
  weightKg: z.number().nonnegative().nullable(),
  distance: z.number().nonnegative().nullable(),
  distanceUnit: z.enum(DISTANCE_UNIT_VALUES).nullable(),
  distanceM: z.number().nonnegative().nullable(),
  durationS: z.number().int().nonnegative().nullable(),
  rpe: z.number().nullable(),
  isComplete: z.boolean(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type SetEntry = z.infer<typeof SetEntrySchema>;

/**
 * POST /v1/workout-exercises/{id}/sets body. `setNumber` and `completedAt` are
 * never client-set (§5). Unit-accompanies-value and the modality rules are
 * handler-level, not a `superRefine` here: on PATCH they must see the merged
 * row, which this schema can't (§6.1, D7).
 *
 * `clientGeneratedId` is an optional idempotency key, unique per
 * workout-exercise: replaying a create that carries one returns the stored
 * set with `200` instead of adding a second row (§6.2, D15).
 */
export const CreateSetSchema = z.strictObject({
  clientGeneratedId: z.guid().optional(),
  setType: z.enum(SET_TYPE_VALUES).optional(),
  reps: Reps.nullable().optional(),
  weight: Weight.nullable().optional(),
  weightUnit: z.enum(WEIGHT_UNIT_VALUES).nullable().optional(),
  distance: Distance.nullable().optional(),
  distanceUnit: z.enum(DISTANCE_UNIT_VALUES).nullable().optional(),
  durationS: DurationS.nullable().optional(),
  rpe: Rpe.nullable().optional(),
  isComplete: z.boolean().optional(),
});
export type CreateSet = z.infer<typeof CreateSetSchema>;

/** PATCH /v1/sets/{id} body — create's fields minus the idempotency key, all
 * optional (§5). */
export const UpdateSetSchema = CreateSetSchema.omit({ clientGeneratedId: true });
export type UpdateSet = z.infer<typeof UpdateSetSchema>;
