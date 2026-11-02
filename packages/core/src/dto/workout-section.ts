/**
 * Spec 09.4 §5 — request bodies for a workout's own sections. `position`, `addedInWorkout` and `id`
 * are never accepted: a new section is always last and its origin is the server's fact. The response
 * shape, `WorkoutSectionSchema`, lives in `dto/workout.ts`; these live here because
 * `routine-section.ts` already imports from `workout.ts` (the reverse would be an import cycle).
 */
import { z } from "zod";
import { SectionNameSchema, SectionNotesSchema } from "./routine-section.js";
import { SectionTimerInputSchema } from "./section-timer.js";

/** Spec 09.5 AC1 — `discardResult` confirms a timer change that would clear recorded data, so it needs a `timer`. */
export const DISCARD_RESULT_NEEDS_TIMER = "only with a timer";

export const CreateWorkoutSectionSchema = z.strictObject({
  name: SectionNameSchema,
  notes: SectionNotesSchema.nullable().optional(),
  /** Spec 09.5 AC12 — the new section's timer; absent or `null` = untimed. */
  timer: SectionTimerInputSchema.nullable().optional(),
});
export type CreateWorkoutSection = z.infer<typeof CreateWorkoutSectionSchema>;

export const UpdateWorkoutSectionSchema = z
  .strictObject({
    name: SectionNameSchema.optional(),
    notes: SectionNotesSchema.nullable().optional(),
    /** Spec 09.5 AC13 — a new timer (`null` removes it); absent leaves the timer and the recorded data alone. */
    timer: SectionTimerInputSchema.nullable().optional(),
    /** Spec 09.5 AC13 — confirms a timer change that would not keep the recorded round times and result. */
    discardResult: z.literal(true).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.discardResult !== undefined && body.timer === undefined) {
      ctx.addIssue({ code: "custom", path: ["discardResult"], message: DISCARD_RESULT_NEEDS_TIMER });
    }
  });
export type UpdateWorkoutSection = z.infer<typeof UpdateWorkoutSectionSchema>;
