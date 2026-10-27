import { z } from "zod";

import { HEVY_RPE_STEPS, HEVY_SET_TYPE_VALUES, HEVY_TYPE_VALUES, type HevyType } from "../hevy/vocabulary.js";

/**
 * Spec 19.0 AC3: Hevy's public API, as this app reads and writes it (field names exactly those of Hevy's OpenAPI
 * document). Read schemas require only the fields the app reads, tolerate absent or `null` optionals and strip
 * unknown keys, because Carol's real data is the input; a missing required field, a wrong type or a template type
 * outside `HEVY_TYPE_VALUES` fails. A set's `type` is read as a plain string, so one odd set type does not fail a
 * whole page (Spec 20.1 D9 marks that workout unreadable). The bodies we send are strict. Messages are Zod's
 * defaults: static, never the parsed value (#57).
 */

/**
 * Spec 19.0 D19 (Carol's data, 2026-10-27): Hevy's replies name two types differently from its documented enum.
 * They are read as the vocabulary's names, so the pairing table, the stored `hevy_type` and the create body keep one
 * vocabulary.
 */
export const HEVY_TYPE_ALIASES: Readonly<Record<string, HevyType>> = Object.freeze({
  bodyweight_weighted: "bodyweight_reps",
  bodyweight_assisted: "bodyweight_assisted_reps",
});

/**
 * A template `type` as Hevy sends it, in the vocabulary; `null` for a type this app does not support (the stair
 * machines' `floors_duration` / `steps_duration`, or any new one), so one such template never fails a whole page. An
 * unsupported template can only be paired as a skip.
 */
export function readHevyType(raw: string): HevyType | null {
  if ((HEVY_TYPE_VALUES as readonly string[]).includes(raw)) return raw as HevyType;
  return Object.hasOwn(HEVY_TYPE_ALIASES, raw) ? HEVY_TYPE_ALIASES[raw]! : null;
}

/** Hevy's muscle groups (its `MuscleGroup` enum), for the bodies we send. Read schemas keep any string. */
export const HEVY_MUSCLE_VALUES = Object.freeze([
  "abdominals",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quadriceps",
  "hamstrings",
  "calves",
  "glutes",
  "abductors",
  "adductors",
  "lats",
  "upper_back",
  "traps",
  "lower_back",
  "chest",
  "cardio",
  "neck",
  "full_body",
  "other",
] as const);
export type HevyMuscle = (typeof HEVY_MUSCLE_VALUES)[number];

/** Hevy's equipment categories (its `EquipmentCategory` enum). */
export const HEVY_EQUIPMENT_VALUES = Object.freeze([
  "none",
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "plate",
  "resistance_band",
  "suspension",
  "other",
] as const);
export type HevyEquipment = (typeof HEVY_EQUIPMENT_VALUES)[number];

const optionalNumber = z.number().nullable().optional();
const optionalString = z.string().nullable().optional();

/** A logged set as Hevy returns it. */
export const HevySetSchema = z.object({
  index: optionalNumber,
  type: z.string(),
  weight_kg: optionalNumber,
  reps: optionalNumber,
  distance_meters: optionalNumber,
  duration_seconds: optionalNumber,
  custom_metric: optionalNumber,
  rpe: optionalNumber,
});
export type HevySet = z.infer<typeof HevySetSchema>;

export const HevyWorkoutExerciseSchema = z.object({
  index: z.number(),
  title: z.string(),
  exercise_template_id: z.string(),
  notes: optionalString,
  superset_id: optionalNumber,
  sets: z.array(HevySetSchema),
});
export type HevyWorkoutExercise = z.infer<typeof HevyWorkoutExerciseSchema>;

export const HevyWorkoutSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: optionalString,
  start_time: z.string(),
  end_time: z.string(),
  updated_at: optionalString,
  exercises: z.array(HevyWorkoutExerciseSchema),
});
export type HevyWorkout = z.infer<typeof HevyWorkoutSchema>;

export const HevyWorkoutPageSchema = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  workouts: z.array(HevyWorkoutSchema),
});
export type HevyWorkoutPage = z.infer<typeof HevyWorkoutPageSchema>;

/** A routine's planned set: a logged set's fields plus Hevy's rep range (Spec 19.1 AC11 reads it). */
export const HevyRoutineSetSchema = HevySetSchema.extend({
  rep_range: z
    .object({ start: optionalNumber, end: optionalNumber })
    .nullable()
    .optional(),
});
export type HevyRoutineSet = z.infer<typeof HevyRoutineSetSchema>;

export const HevyRoutineExerciseSchema = z.object({
  index: z.number(),
  title: z.string(),
  exercise_template_id: z.string(),
  notes: optionalString,
  superset_id: optionalNumber,
  rest_seconds: optionalNumber,
  sets: z.array(HevyRoutineSetSchema),
});
export type HevyRoutineExercise = z.infer<typeof HevyRoutineExerciseSchema>;

export const HevyRoutineSchema = z.object({
  id: z.string(),
  title: z.string(),
  folder_id: z.number().nullable(),
  exercises: z.array(HevyRoutineExerciseSchema),
});
export type HevyRoutine = z.infer<typeof HevyRoutineSchema>;

export const HevyRoutinePageSchema = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  routines: z.array(HevyRoutineSchema),
});
export type HevyRoutinePage = z.infer<typeof HevyRoutinePageSchema>;

export const HevyFolderSchema = z.object({
  id: z.number(),
  index: z.number(),
  title: z.string(),
});
export type HevyFolder = z.infer<typeof HevyFolderSchema>;

export const HevyFolderPageSchema = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  routine_folders: z.array(HevyFolderSchema),
});
export type HevyFolderPage = z.infer<typeof HevyFolderPageSchema>;

export const HevyTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string().transform(readHevyType),
  is_custom: z.boolean(),
  // Kept as strings: a value outside Hevy's list maps to "Not set" through the reference tables (AC15).
  primary_muscle_group: optionalString,
  secondary_muscle_groups: z.array(z.string()).nullable().optional(),
  equipment: optionalString,
});
export type HevyTemplate = z.infer<typeof HevyTemplateSchema>;

export const HevyTemplatePageSchema = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  exercise_templates: z.array(HevyTemplateSchema),
});
export type HevyTemplatePage = z.infer<typeof HevyTemplatePageSchema>;

/** `GET /v1/user/info`: the reply is wrapped in `data`. */
export const HevyUserInfoSchema = z.object({
  data: z.object({
    id: z.string(),
    name: optionalString,
    url: optionalString,
  }),
});
export type HevyUserInfo = z.infer<typeof HevyUserInfoSchema>;

/** `GET /v1/workouts/count`. */
export const HevyWorkoutCountSchema = z.object({
  workout_count: z.number().int().min(0),
});
export type HevyWorkoutCount = z.infer<typeof HevyWorkoutCountSchema>;

/** `POST /v1/workouts` answers the created workout as a one-element array. */
export const HevyCreateWorkoutReplySchema = z.object({
  workout: z.tuple([HevyWorkoutSchema]),
});
export type HevyCreateWorkoutReply = z.infer<typeof HevyCreateWorkoutReplySchema>;

/** `PUT /v1/workouts/{id}` answers the bare workout. */
export const HevyUpdateWorkoutReplySchema = HevyWorkoutSchema;
export type HevyUpdateWorkoutReply = z.infer<typeof HevyUpdateWorkoutReplySchema>;

/** `POST /v1/exercise_templates` answers `{ id }`; the id is documented as an integer and returned here as a string. */
export const HevyCreateTemplateReplySchema = z.object({
  id: z.union([z.string(), z.number()]).transform((id) => String(id)),
});
export type HevyCreateTemplateReply = z.infer<typeof HevyCreateTemplateReplySchema>;

/** The body of `POST /v1/exercise_templates` (Hevy's `CreateCustomExerciseRequestBody`). */
export const HevyCreateTemplateBodySchema = z.strictObject({
  exercise: z.strictObject({
    title: z.string(),
    exercise_type: z.enum(HEVY_TYPE_VALUES),
    equipment_category: z.enum(HEVY_EQUIPMENT_VALUES),
    muscle_group: z.enum(HEVY_MUSCLE_VALUES),
    other_muscles: z.array(z.enum(HEVY_MUSCLE_VALUES)),
  }),
});
export type HevyCreateTemplateBody = z.infer<typeof HevyCreateTemplateBodySchema>;

const HEVY_RPE_STEP_MESSAGE = "must be one of Hevy's RPE steps";

/** A set we send. Only the fields its Hevy type holds are present (AC8); `custom_metric` is never written. */
export const HevyPostSetSchema = z.strictObject({
  type: z.enum(HEVY_SET_TYPE_VALUES),
  weight_kg: z.number().nullable().optional(),
  reps: z.number().int().nullable().optional(),
  distance_meters: z.number().int().nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
  rpe: z
    .number()
    .refine((v) => (HEVY_RPE_STEPS as readonly number[]).includes(v), HEVY_RPE_STEP_MESSAGE)
    .nullable()
    .optional(),
});
export type HevyPostSet = z.infer<typeof HevyPostSetSchema>;

export const HevyPostExerciseSchema = z.strictObject({
  exercise_template_id: z.string(),
  superset_id: z.number().int().nullable(),
  notes: z.string().nullable(),
  sets: z.array(HevyPostSetSchema),
});
export type HevyPostExercise = z.infer<typeof HevyPostExerciseSchema>;

/** The workout body we send to `POST` / `PUT /v1/workouts` (AC11). */
export const HevyPostWorkoutSchema = z.strictObject({
  workout: z.strictObject({
    title: z.string(),
    description: z.string().nullable(),
    start_time: z.string(),
    end_time: z.string(),
    is_private: z.boolean(),
    exercises: z.array(HevyPostExerciseSchema),
  }),
});
export type HevyPostWorkout = z.infer<typeof HevyPostWorkoutSchema>;
