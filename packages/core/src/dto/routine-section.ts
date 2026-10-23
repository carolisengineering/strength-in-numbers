/**
 * Spec 09.2 §5 — routine section DTOs. `key` is request-local: it names a section inside one
 * POST/PUT body so items can reference it before any row id exists (whole-document replace,
 * Spec 09 D2). It is never stored and never returned. The workout-side `WorkoutSectionSchema`
 * lives in `dto/workout.ts` (this file imports from it; the reverse would be an import cycle).
 */
import { z } from "zod";
import { RoutineSectionIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";
import { noControlCharsExceptWhitespace } from "./workout.js";

export const ROUTINE_SECTIONS_MAX = 8;
export const SECTION_NAME_MAX = 40;
export const SECTION_NOTES_MAX = 2000;
export const SECTION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** A section's name: trimmed, 1–40 characters, no control characters. Shared by routine and workout sections. */
export const SectionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SECTION_NAME_MAX)
  .refine(noControlChars, "control characters not allowed");

/** A section's note: 1–2 000 characters; TAB / LF / CR allowed, no other control characters. */
export const SectionNotesSchema = z
  .string()
  .min(1)
  .max(SECTION_NOTES_MAX)
  .refine(noControlCharsExceptWhitespace, "control characters not allowed");

/** One section in a POST/PUT body. Position is the array index; `key` is request-local and never stored. */
export const RoutineSectionInputSchema = z.strictObject({
  key: z.string().regex(SECTION_KEY_PATTERN),
  name: SectionNameSchema,
  notes: SectionNotesSchema.nullable().optional(),
});
export type RoutineSectionInput = z.infer<typeof RoutineSectionInputSchema>;

/** A routine's section as returned (Task 3 puts it on `RoutineSchema`). */
export const RoutineSectionSchema = z.object({
  id: RoutineSectionIdSchema,
  position: z.number().int().min(0),
  name: z.string(),
  notes: z.string().nullable(),
});
export type RoutineSection = z.infer<typeof RoutineSectionSchema>;
