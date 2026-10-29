import { z } from "zod";

import { WorkoutIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";
import { HEVY_ID_MAX, HEVY_TITLE_MAX } from "./hevy.js";
import { HEVY_SET_TYPE_VALUES } from "../hevy/vocabulary.js";

/**
 * Spec 19.1 §5.1: the bulk import's request and result DTOs. The request mirrors Hevy's shape in camelCase; strings
 * are sanitized and numbers range-checked by the translator (a bad set is a reported drop, never a failed batch), so
 * the schema bounds only sizes and types. Every message is fixed text (#57).
 */

export const HEVY_IMPORT_BATCH_MAX = 25;
export const HEVY_IMPORT_EXERCISES_MAX = 200;
export const HEVY_IMPORT_SETS_MAX = 200;
export const HEVY_IMPORT_DESCRIPTION_MAX = 20_000;

/** AC1: what happened to one Hevy workout. */
export const HEVY_IMPORT_OUTCOME_VALUES = Object.freeze([
  "create",
  "already_imported",
  "sent_from_sin",
  "already_matched",
  "deleted_in_sin",
  "duplicate",
  "unpaired",
  "no_usable_sets",
  "time_invalid",
  "rejected",
] as const);
export type HevyImportOutcome = (typeof HEVY_IMPORT_OUTCOME_VALUES)[number];

/**
 * AC1: why sets or exercises were left out. Every code counts sets except `exercise_no_sets`, which counts exercises
 * whose sets were all dropped (those sets are already counted under their own codes), so it is left out of any set
 * total (minor 149).
 */
export const HEVY_IMPORT_DROP_CODES = Object.freeze([
  "exercise_skipped",
  "exercise_no_sets",
  "set_missing_measure",
  "set_forbidden_measure",
  "set_out_of_range",
] as const);
export type HevyImportDropCode = (typeof HEVY_IMPORT_DROP_CODES)[number];

/** AC1: what the import changed or set aside without dropping a set. */
export const HEVY_IMPORT_NOTICE_CODES = Object.freeze([
  "custom_metric_ignored",
  "assist_weight_ignored",
  "placeholder_sets_ignored",
  "section_empty",
  "sections_over_limit",
  "section_name_trimmed",
  "section_notes_trimmed",
  "superset_over_limit",
  "title_trimmed",
  "notes_trimmed",
] as const);
export type HevyImportNoticeCode = (typeof HEVY_IMPORT_NOTICE_CODES)[number];

/** AC11: what a routine translation changed. */
export const HEVY_ROUTINE_NOTICE_CODES = Object.freeze([
  "name_trimmed",
  "items_cut",
  "rest_clamped",
  "superset_cut",
  "time_targets_not_kept",
  "distance_targets_not_kept",
  "sets_cut",
  "notes_trimmed",
  "section_empty",
  "sections_over_limit",
  "section_name_trimmed",
  "section_notes_trimmed",
] as const);
export type HevyRoutineNoticeCode = (typeof HEVY_ROUTINE_NOTICE_CODES)[number];

/** A code and how many times it happened (never 0 in a result). */
export interface CodeCount<C extends string> {
  code: C;
  count: number;
}

const CONTROL_CHARS = "control characters not allowed";

const hevyId = z.string().min(1).max(HEVY_ID_MAX).refine(noControlChars, CONTROL_CHARS);
const measure = z.number().finite().nullable();

/** One Hevy set. */
export const HevyImportSetSchema = z.strictObject({
  type: z.enum(HEVY_SET_TYPE_VALUES),
  weightKg: measure,
  reps: measure,
  distanceMeters: measure,
  durationSeconds: measure,
  rpe: measure,
  customMetric: measure,
});
export type HevyImportSetInput = z.infer<typeof HevyImportSetSchema>;

/** One Hevy exercise, in workout order. */
export const HevyImportExerciseSchema = z.strictObject({
  exerciseTemplateId: hevyId,
  notes: z.string().nullable(),
  supersetId: z.number().int().min(0).nullable(),
  sets: z.array(HevyImportSetSchema).max(HEVY_IMPORT_SETS_MAX),
});
export type HevyImportExercise = z.infer<typeof HevyImportExerciseSchema>;

/** One Hevy workout. */
export const HevyImportWorkoutSchema = z.strictObject({
  hevyWorkoutId: hevyId,
  title: z.string().max(HEVY_TITLE_MAX).nullable(),
  description: z.string().max(HEVY_IMPORT_DESCRIPTION_MAX).nullable(),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
  tzOffsetMinutes: z.number().int().min(-720).max(840),
  exercises: z.array(HevyImportExerciseSchema).max(HEVY_IMPORT_EXERCISES_MAX),
});
export type HevyImportWorkout = z.infer<typeof HevyImportWorkoutSchema>;

/** `POST /v1/hevy/import/workouts` body. */
export const HevyImportBatchSchema = z.strictObject({
  dryRun: z.boolean(),
  workouts: z.array(HevyImportWorkoutSchema).min(1).max(HEVY_IMPORT_BATCH_MAX),
});
export type HevyImportBatch = z.infer<typeof HevyImportBatchSchema>;

const codeCount = <const T extends readonly [string, ...string[]]>(codes: T) =>
  z.object({ code: z.enum(codes), count: z.number().int().min(1) });

/** One workout's result, in request order. */
export const HevyImportResultSchema = z.object({
  hevyWorkoutId: z.string(),
  outcome: z.enum(HEVY_IMPORT_OUTCOME_VALUES),
  workoutId: WorkoutIdSchema.nullable(),
  matchedWorkoutId: WorkoutIdSchema.nullable(),
  unpaired: z.array(z.string()),
  drops: z.array(codeCount(HEVY_IMPORT_DROP_CODES)),
  notices: z.array(codeCount(HEVY_IMPORT_NOTICE_CODES)),
  exerciseCount: z.number().int().min(0),
  setCount: z.number().int().min(0),
});
export type HevyImportResult = z.infer<typeof HevyImportResultSchema>;

export const HevyImportResponseSchema = z.object({
  dryRun: z.boolean(),
  results: z.array(HevyImportResultSchema),
});
export type HevyImportResponse = z.infer<typeof HevyImportResponseSchema>;

/** `POST /v1/hevy/import/finish` response. */
export const HevyImportFinishResponseSchema = z.object({
  recomputed: z.boolean(),
  rootCount: z.number().int().min(0),
});
export type HevyImportFinishResponse = z.infer<typeof HevyImportFinishResponseSchema>;
