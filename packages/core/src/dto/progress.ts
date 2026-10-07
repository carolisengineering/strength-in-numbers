/**
 * Progress series DTOs (Spec 07.2 §5). Imports only ids (acyclic, 05.1 D12).
 * Metric values are JSON numbers converted from integer milli with no
 * division (07.0 D14); all are null when that session had no qualifying set.
 */
import { z } from "zod";
import { ExerciseIdSchema, WorkoutIdSchema } from "../ids.js";

export const ProgressPointSchema = z.object({
  workoutId: WorkoutIdSchema,
  localDate: z.iso.date(),
  startedAt: z.iso.datetime({ offset: true }),
  /** kg — heaviest_weight's per-set rule. */
  topSetWeight: z.number().positive().nullable(),
  /** kg — best_est_1rm's per-set rule (Epley, 1–12 reps). */
  bestE1rm: z.number().positive().nullable(),
  /** kg × reps — a SESSION SUM of setVolumeMilli. */
  totalVolume: z.number().positive().nullable(),
  /** reps — bodyweight_reps only. */
  maxReps: z.number().int().positive().nullable(),
});
export type ProgressPoint = z.infer<typeof ProgressPointSchema>;

export const ProgressSeriesSchema = z.object({
  /** The lineage root (07.0 §6.2). */
  exerciseId: ExerciseIdSchema,
  points: z.array(ProgressPointSchema),
});
export type ProgressSeries = z.infer<typeof ProgressSeriesSchema>;

/** A calendar date Postgres can cast: it has no year 0 (Review Focus 1). */
const ProgressDate = z.iso.date().refine((d) => d >= "0001-01-01", "year must be 0001 or later");

/** `GET /v1/progress/exercises/{id}` querystring — inclusive, on local_date. */
export const ProgressQuerySchema = z
  .object({ from: ProgressDate.optional(), to: ProgressDate.optional() })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ["from"],
    message: "from must not be after to",
  });
export type ProgressQuery = z.infer<typeof ProgressQuerySchema>;
