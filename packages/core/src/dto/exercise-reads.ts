/**
 * Spec 03.4 §5.1–§5.2 — the two read-only views behind the Exercises tab. Derived from routines and workouts, never
 * stored, so the account export does not carry them.
 */
import { z } from "zod";
import { ExerciseIdSchema, RoutineIdSchema } from "../ids.js";

/** A routine that uses an exercise: just enough for the delete warning. */
export const ExerciseRoutineRefSchema = z.object({
  id: RoutineIdSchema,
  name: z.string(),
  /** Spec 09.3: an ISO UTC instant for a one-off, `null` for an ordinary routine. */
  oneOffUntil: z.iso.datetime({ offset: true }).nullable(),
});
export type ExerciseRoutineRef = z.infer<typeof ExerciseRoutineRefSchema>;

/** `GET /v1/exercises/{id}/routines` — ordered `lower(name)`, `id`. */
export const ExerciseRoutinesResponseSchema = z.object({ routines: z.array(ExerciseRoutineRefSchema) });
export type ExerciseRoutinesResponse = z.infer<typeof ExerciseRoutinesResponseSchema>;

/** Last logged per lineage root (Spec 03.4 §5.2): `rootId` is the built-in's id for a fork; map rows with `lineageRootId`. */
export const ExerciseUsageSchema = z.object({
  rootId: ExerciseIdSchema,
  /** `workout.local_date`, `YYYY-MM-DD`, never through a JS Date. */
  lastLoggedOn: z.iso.date(),
});
export type ExerciseUsage = z.infer<typeof ExerciseUsageSchema>;

/** `GET /v1/exercises/usage` — ordered `lastLoggedOn` descending, then `rootId`. */
export const ExerciseUsageResponseSchema = z.object({ exercises: z.array(ExerciseUsageSchema) });
export type ExerciseUsageResponse = z.infer<typeof ExerciseUsageResponseSchema>;
