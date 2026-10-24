import {
  SECTION_NAME_MAX,
  SECTION_NOTES_MAX,
  noControlChars,
  noControlCharsExceptWhitespace,
  type WorkoutSection,
} from "@sin/core";
import { SECTION_COPY } from "./sectionCopy";

export interface SectionValues {
  readonly name: string;
  readonly notes: string;
}

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
 * Spec 10.6 AC6 / AC7 — the request body. Add: `{ name }` or `{ name, notes }`. Edit: only the changed
 * keys (an emptied note is `notes: null`), or `null` when nothing changed.
 */
export function sectionBody(
  mode: "add" | "edit",
  values: SectionValues,
  stored?: WorkoutSection,
): { name?: string; notes?: string | null } | null {
  const name = values.name.trim();
  const notes = noteOf(values.notes);
  if (mode === "add" || stored === undefined) return notes === null ? { name } : { name, notes };
  const body: { name?: string; notes?: string | null } = {};
  if (name !== stored.name) body.name = name;
  if (notes !== stored.notes) body.notes = notes;
  return Object.keys(body).length === 0 ? null : body;
}
