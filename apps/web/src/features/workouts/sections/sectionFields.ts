import {
  SECTION_NAME_MAX,
  SECTION_NOTES_MAX,
  noControlChars,
  noControlCharsExceptWhitespace,
  type CreateWorkoutSection,
  type SectionTimer,
  type UpdateWorkoutSection,
  type WorkoutSection,
} from "@sin/core";
import { sameTimer, toTimerInput } from "../../sectionTimer/timerFields";
import { SECTION_COPY } from "./sectionCopy";

export interface SectionValues {
  readonly name: string;
  readonly notes: string;
  /**
   * Spec 10.7 AC15: the Timer group, already parsed (`null` = no timer). Absent leaves the timer alone: an add is
   * untimed and an edit sends no `timer` key (a caller that has no Timer group, as 10.6's did).
   */
  readonly timer?: SectionTimer | null;
}

/** The section write bodies (Spec 09.5's `CreateWorkoutSection` / `UpdateWorkoutSection` request types). */
export type AddSectionBody = CreateWorkoutSection;
export type UpdateSectionBody = UpdateWorkoutSection;

/** A note that is only whitespace is no note. */
const noteOf = (notes: string): string | null => (notes.trim() === "" ? null : notes);

/**
 * Spec 10.6 AC5 — the client's advisory checks, mirroring `SectionNameSchema` / `SectionNotesSchema`
 * (the server's `422` is authoritative and maps to the same texts).
 */
export function checkSectionFields(name: string, notes: string): { name: string | null; notes: string | null } {
  const trimmed = name.trim();
  const nameError =
    trimmed === ""
      ? SECTION_COPY.nameRequired
      : trimmed.length > SECTION_NAME_MAX
        ? SECTION_COPY.nameTooLong
        : !noControlChars(trimmed)
          ? SECTION_COPY.badChars
          : null;
  const note = noteOf(notes);
  const notesError =
    note === null
      ? null
      : note.length > SECTION_NOTES_MAX
        ? SECTION_COPY.noteTooLong
        : !noControlCharsExceptWhitespace(note)
          ? SECTION_COPY.badChars
          : null;
  return { name: nameError, notes: notesError };
}

/**
 * Spec 10.6 AC6 / AC7, 10.7 AC15 — the request body. Add: `{ name, notes?, timer? }`, `timer` only when set.
 * Edit: only the changed keys (an emptied note is `notes: null`; a removed timer is `timer: null`; a timer that
 * is the same plan is no change), or `null` when nothing changed.
 */
export function sectionBody(mode: "add", values: SectionValues): AddSectionBody;
export function sectionBody(mode: "add" | "edit", values: SectionValues, stored?: WorkoutSection): AddSectionBody | UpdateSectionBody | null;
export function sectionBody(mode: "add" | "edit", values: SectionValues, stored?: WorkoutSection): AddSectionBody | UpdateSectionBody | null {
  const name = values.name.trim();
  const notes = noteOf(values.notes);
  const timer = values.timer;
  if (mode === "add" || stored === undefined) {
    return { name, ...(notes === null ? {} : { notes }), ...(timer === undefined || timer === null ? {} : { timer: toTimerInput(timer) }) };
  }
  const body: UpdateSectionBody = {};
  if (name !== stored.name) body.name = name;
  if (notes !== stored.notes) body.notes = notes;
  if (timer !== undefined && !sameTimer(timer, stored.timer)) body.timer = timer === null ? null : toTimerInput(timer);
  return Object.keys(body).length === 0 ? null : body;
}
