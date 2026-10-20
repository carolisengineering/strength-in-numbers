import { UpdateWorkoutSchema, type Workout } from "@sin/core";
import type { WorkoutUpdate } from "../workoutClient";
import { EDIT_COPY } from "./editCopy";

/**
 * Spec 18.0 §6.9 / AC53–AC54, pure: a workout's title and notes as typed text. The server is the authority; this is
 * the courtesy check with the same schema, so the lifter sees why before a request is made.
 */
export type DetailsField = "title" | "notes";

export interface DetailsForm {
  title: string;
  notes: string;
}

export function initialForm(w: Pick<Workout, "title" | "notes">): DetailsForm {
  return { title: w.title ?? "", notes: w.notes ?? "" };
}

/** Trim the ends (internal line breaks and spaces stay); empty means "clear it" (`null`): the API rejects `""`. */
export function normalize(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The §5.7 copy for `text`, or `null` when it can be saved. The issue's *kind* picks the copy; its message (static,
 * #57) is never shown.
 */
export function validate(field: DetailsField, text: string): string | null {
  const result = UpdateWorkoutSchema.safeParse({ [field]: normalize(text) });
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  if (issue.code === "too_big") return field === "title" ? EDIT_COPY.details.titleTooLong : EDIT_COPY.details.notesTooLong;
  if (issue.code === "custom") return EDIT_COPY.details.control;
  return EDIT_COPY.details.other;
}

/** Only the fields whose text changed, each normalized; `null` when nothing changed (no request). */
export function buildPatch(initial: DetailsForm, form: DetailsForm): WorkoutUpdate | null {
  const patch: { title?: string | null; notes?: string | null } = {};
  if (form.title !== initial.title) patch.title = normalize(form.title);
  if (form.notes !== initial.notes) patch.notes = normalize(form.notes);
  return Object.keys(patch).length === 0 ? null : patch;
}
