/**
 * Workout session lifecycle DTOs (Spec 05.0 §5). `XxxSchema` for the Zod
 * value, bare `Xxx` for the inferred type (D48) — no `Body`/`Response`
 * suffix. Response schemas are `z.object` (field allowlist, Spec 03.0 §6.5);
 * request bodies are `z.strictObject` (unknown key -> 422, never dropped).
 */
import { z } from "zod";
import { MODALITY_VALUES, WORKOUT_SOURCE_VALUES } from "../enums.js";
import { ExerciseIdSchema, RoutineIdSchema, WorkoutExerciseIdSchema, WorkoutIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";
import { PersonalRecordSchema } from "./personal-record.js";
import { SetEntrySchema } from "./set-entry.js";

export const WORKOUT_TITLE_MAX = 120;
export const WORKOUT_NOTES_MAX = 4000;

/** Clock-skew bounds (§6.4, D47), in milliseconds. The future bound also
 * bounds `endedAt` on finish; the past bound applies to `startedAt` alone. */
export const WORKOUT_FUTURE_SKEW_MAX_MS = 5 * 60 * 1000; // 300_000
export const WORKOUT_STARTED_AT_PAST_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 604_800_000

/** Like `noControlChars`, but permits TAB, LF, CR — notes are multi-line
 * prose, a title is a single line. Still rejects every other C0 char and DEL. */
export const noControlCharsExceptWhitespace = (s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!isAllowedWhitespace && (code <= 0x1f || code === 0x7f)) return false;
  }
  return true;
};

const WorkoutTitle = z
  .string()
  .min(1)
  .max(WORKOUT_TITLE_MAX)
  .refine(noControlChars, "control characters not allowed");
const WorkoutNotes = z
  .string()
  .min(1)
  .max(WORKOUT_NOTES_MAX)
  .refine(noControlCharsExceptWhitespace, "control characters not allowed");

// Minutes EAST of UTC (§6.3). Real-world offsets run UTC-12:00..UTC+14:00.
const TzOffsetMinutes = z.number().int().min(-720).max(840);

/** One workout session. */
export const WorkoutSchema = z.object({
  id: WorkoutIdSchema,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  localDate: z.iso.date(),
  tzOffsetMinutes: TzOffsetMinutes,
  clientGeneratedId: z.guid(),
  source: z.enum(WORKOUT_SOURCE_VALUES),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Spec 09 D15/D20: the routine's name as it was at start; `null` for a manual start. */
  routineName: z.string().nullable(),
});
export type Workout = z.infer<typeof WorkoutSchema>;

/** One exercise within a workout. */
export const WorkoutExerciseSchema = z.object({
  id: WorkoutExerciseIdSchema,
  workoutId: WorkoutIdSchema,
  position: z.number().int().min(0),
  exerciseId: ExerciseIdSchema,
  exerciseNameSnapshot: z.string(),
  modalitySnapshot: z.enum(MODALITY_VALUES),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  // Spec 09 AC24: target snapshots copied at start-from-routine (null when added
  // by hand) and the live superset group (D10).
  targetSets: z.number().int().nullable(),
  targetRepsLow: z.number().int().nullable(),
  targetRepsHigh: z.number().int().nullable(),
  /** Decimal (8.5); stored as tenths (Spec 09 D5). */
  targetRpe: z.number().nullable(),
  restSeconds: z.number().int().nullable(),
  supersetGroup: z.number().int().nullable(),
});
export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>;

/** One exercise within a workout, with its sets ordered by `setNumber`
 * (Spec 05.1 §4, AC12). Defined here, not in `dto/set-entry.ts`, to keep the
 * two modules acyclic (Spec 05.1 D12). */
export const WorkoutExerciseDetailSchema = WorkoutExerciseSchema.extend({
  sets: z.array(SetEntrySchema),
});
export type WorkoutExerciseDetail = z.infer<typeof WorkoutExerciseDetailSchema>;

/** GET /v1/workouts/active and GET /v1/workouts/{id}. */
export const WorkoutDetailSchema = WorkoutSchema.extend({
  exercises: z.array(WorkoutExerciseDetailSchema),
});
export type WorkoutDetail = z.infer<typeof WorkoutDetailSchema>;

/** POST /v1/workouts body. */
export const CreateWorkoutSchema = z.strictObject({
  clientGeneratedId: z.guid(),
  startedAt: z.iso.datetime({ offset: true }),
  tzOffsetMinutes: TzOffsetMinutes.optional(),
  title: WorkoutTitle.nullable().optional(),
  notes: WorkoutNotes.nullable().optional(),
  /** Spec 09 D11: start from a routine. Ignored on an idempotent replay (05.0 D39). */
  routineId: RoutineIdSchema.optional(),
});
export type CreateWorkout = z.infer<typeof CreateWorkoutSchema>;

/** PATCH /v1/workouts/{id} body. */
export const UpdateWorkoutSchema = z.strictObject({
  title: WorkoutTitle.nullable().optional(),
  notes: WorkoutNotes.nullable().optional(),
  endedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateWorkout = z.infer<typeof UpdateWorkoutSchema>;

/** POST /v1/workouts/{id}/exercises body. */
export const AddWorkoutExerciseSchema = z.strictObject({
  exerciseId: ExerciseIdSchema,
  position: z.number().int().min(0).optional(),
  notes: WorkoutNotes.nullable().optional(),
});
export type AddWorkoutExercise = z.infer<typeof AddWorkoutExerciseSchema>;

/** PATCH /v1/workout-exercises/{id} body. */
export const UpdateWorkoutExerciseSchema = z.strictObject({
  position: z.number().int().min(0).optional(),
  notes: WorkoutNotes.nullable().optional(),
  /** Spec 09 D10: any 1..99, `null` clears; no density or adjacency rule on a workout. */
  supersetGroup: z.number().int().min(1).max(99).nullable().optional(),
});
export type UpdateWorkoutExercise = z.infer<typeof UpdateWorkoutExerciseSchema>;

/** `PATCH /v1/workouts/{id}` 200 body (Spec 07.0 §5, D12): the workout plus
 * the records it holds after this request — `[]` for any non-finish PATCH.
 * A new name, not a change to `WorkoutSchema`, which other routes share. */
export const UpdatedWorkoutSchema = WorkoutSchema.extend({
  newRecords: z.array(PersonalRecordSchema),
});
export type UpdatedWorkout = z.infer<typeof UpdatedWorkoutSchema>;

/** `GET /v1/workouts` page size (Spec 07.1 D2). */
export const WORKOUT_HISTORY_LIMIT_DEFAULT = 20;
export const WORKOUT_HISTORY_LIMIT_MAX = 50;
/** How many exercise names a history row carries; the SQL `LIMIT` uses it too (D16). */
export const WORKOUT_SUMMARY_NAMES_MAX = 3;

/** One row of the history list: the Workout plus a summary (Spec 07.1 §5). A new
 * name rather than a change to `WorkoutSchema`, which other routes share. */
export const WorkoutSummarySchema = WorkoutSchema.extend({
  exerciseCount: z.number().int().min(0),
  /** The first names by position — the snapshots taken when each was added. */
  exerciseNames: z.array(z.string()).max(WORKOUT_SUMMARY_NAMES_MAX),
  /** `set_type = 'working'` sets, any `is_complete` (D4). */
  workingSetCount: z.number().int().min(0),
  /** kg × reps over qualifying working sets; `null` when none qualifies — never 0. */
  totalVolume: z.number().positive().nullable(),
  /** `personal_record` rows this workout holds now (07.0 D18). */
  recordCount: z.number().int().min(0),
});
export type WorkoutSummary = z.infer<typeof WorkoutSummarySchema>;

/** Querystring values arrive as strings: digits only, then an integer in range (D11). */
const HistoryLimit = z
  .string()
  .regex(/^\d{1,3}$/, "must be a whole number")
  .transform(Number)
  .pipe(z.number().int().min(1).max(WORKOUT_HISTORY_LIMIT_MAX))
  .default(WORKOUT_HISTORY_LIMIT_DEFAULT);

/** `GET /v1/workouts` querystring. `cursor` is decoded and validated server-side (§6.2). */
export const WorkoutHistoryQuerySchema = z.object({
  limit: HistoryLimit,
  cursor: z.string().optional(),
});
export type WorkoutHistoryQuery = z.infer<typeof WorkoutHistoryQuerySchema>;

export const WorkoutHistoryResponseSchema = z.object({
  items: z.array(WorkoutSummarySchema),
  next: z.string().nullable(),
});
export type WorkoutHistoryResponse = z.infer<typeof WorkoutHistoryResponseSchema>;
