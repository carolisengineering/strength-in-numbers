/**
 * Personal-record DTOs (Spec 07.0 §5). Imports only enums + ids so
 * `dto/workout.ts` can import this module without a cycle (05.1 D12).
 * `value` / `previousValue` are JSON numbers, like set `weight` (D14);
 * all comparison happens on integers in `records.ts` or `numeric` in Postgres.
 */
import { z } from "zod";
import { RECORD_TYPE_VALUES, RECORD_UNIT_VALUES } from "../enums.js";
import { ExerciseIdSchema, SetEntryIdSchema, WorkoutIdSchema } from "../ids.js";

export const PersonalRecordSchema = z.object({
  /** The lineage root (Spec 07.0 §6.2) — not necessarily the exercise logged. */
  exerciseId: ExerciseIdSchema,
  /** The source set's own exercise — label the record as the user sees it now. */
  sourceExerciseId: ExerciseIdSchema,
  /** The source workout_exercise's name snapshot. */
  exerciseName: z.string(),
  recordType: z.enum(RECORD_TYPE_VALUES),
  value: z.number().positive(),
  unit: z.enum(RECORD_UNIT_VALUES),
  previousValue: z.number().positive().nullable(),
  sourceSetId: SetEntryIdSchema,
  workoutId: WorkoutIdSchema,
  achievedAt: z.iso.datetime({ offset: true }),
  localDate: z.iso.date(),
});
export type PersonalRecord = z.infer<typeof PersonalRecordSchema>;

/** `GET /v1/personal-records` querystring — both filters optional (§5). */
export const PersonalRecordsQuerySchema = z.object({
  exerciseId: ExerciseIdSchema.optional(),
  workoutId: WorkoutIdSchema.optional(),
});
export type PersonalRecordsQuery = z.infer<typeof PersonalRecordsQuerySchema>;

export const PersonalRecordsResponseSchema = z.object({
  records: z.array(PersonalRecordSchema),
});
export type PersonalRecordsResponse = z.infer<typeof PersonalRecordsResponseSchema>;
