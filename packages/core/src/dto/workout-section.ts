/**
 * Spec 09.4 §5 — request bodies for a workout's own sections. `position`, `addedInWorkout` and `id`
 * are never accepted: a new section is always last and its origin is the server's fact. The response
 * shape, `WorkoutSectionSchema`, lives in `dto/workout.ts`; these live here because
 * `routine-section.ts` already imports from `workout.ts` (the reverse would be an import cycle).
 */
import { z } from "zod";
import { SectionNameSchema, SectionNotesSchema } from "./routine-section.js";

export const CreateWorkoutSectionSchema = z.strictObject({
  name: SectionNameSchema,
  notes: SectionNotesSchema.nullable().optional(),
});
export type CreateWorkoutSection = z.infer<typeof CreateWorkoutSectionSchema>;

export const UpdateWorkoutSectionSchema = z.strictObject({
  name: SectionNameSchema.optional(),
  notes: SectionNotesSchema.nullable().optional(),
});
export type UpdateWorkoutSection = z.infer<typeof UpdateWorkoutSectionSchema>;
