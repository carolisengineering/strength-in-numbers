/**
 * Workout session lifecycle DTOs (Spec 05.0 §5). `XxxSchema` for the Zod
 * value, bare `Xxx` for the inferred type (D48) — no `Body`/`Response`
 * suffix. Response schemas are `z.object` (field allowlist, Spec 03.0 §6.5);
 * request bodies are `z.strictObject` (unknown key -> 422, never dropped).
 */
import { z } from "zod";
import { MODALITY_VALUES, WORKOUT_SOURCE_VALUES } from "../enums.js";
import { ExerciseIdSchema, WorkoutExerciseIdSchema, WorkoutIdSchema } from "../ids.js";
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
});
export type UpdateWorkoutExercise = z.infer<typeof UpdateWorkoutExerciseSchema>;

/** `PATCH /v1/workouts/{id}` 200 body (Spec 07.0 §5, D12): the workout plus
 * the records it holds after this request — `[]` for any non-finish PATCH.
 * A new name, not a change to `WorkoutSchema`, which other routes share. */
export const UpdatedWorkoutSchema = WorkoutSchema.extend({
  newRecords: z.array(PersonalRecordSchema),
});
export type UpdatedWorkout = z.infer<typeof UpdatedWorkoutSchema>;
