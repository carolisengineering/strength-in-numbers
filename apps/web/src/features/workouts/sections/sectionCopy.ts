import { ROUTINE_SECTIONS_MAX, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "@sin/core";

/**
 * Spec 10.6 AC22 — every string the section controls show, on the live and the edit screen. Tests
 * pin each one by exact text. Nothing here echoes a server message.
 */
export const SECTION_COPY = Object.freeze({
  edit: "Edit",
  addSection: "Add section",
  cancel: "Cancel",
  save: "Save",
  removeSection: "Remove section",
  removeConfirm: "Remove",
  empty: "No exercises yet.",
  limit: `A workout can have up to ${ROUTINE_SECTIONS_MAX} sections.`,
  lineBefore: "New exercises go into ",
  lineAfter: ".",
  newTitle: "New section",
  newIntro: "Exercises you add next go into this section.",
  editTitle: "Edit section",
  nameLabel: "Name",
  noteLabel: "Note",
  noteHint: "Anything beyond sets and reps.",
  nameRequired: "Enter a name.",
  nameTooLong: `Keep the name to ${SECTION_NAME_MAX} characters.`,
  noteTooLong: `Keep the note to ${SECTION_NOTES_MAX} characters.`,
  badChars: "Remove characters that can't be saved.",
  fieldsGeneric: "Check the name and note and try again.",
  removeLine: "Its exercises and sets stay in the workout, without a section.",
  saved: "Section saved",
  removed: "Section removed",
  sectionLabel: "Section",
  noSection: "No section",
  supersetHint: "Changing the section takes it out of its superset.",
  sectionGone: "That section no longer exists",
  addUnconfirmed: "Couldn't confirm that section was added — check your workout before adding it again",
  saveFailed: "Couldn't save the section — try again",
  removeFailed: "Couldn't remove the section — try again",
  moveFailed: "Couldn't move that exercise — try again",
});

export const editLabel = (name: string): string => `Edit section ${name}`;
export const removeTitle = (name: string): string => `Remove ${name}?`;
export const sectionAdded = (name: string): string => `Section added: ${name}`;
export const movedTo = (exercise: string, section: string): string => `Moved ${exercise} to ${section}`;
export const movedOut = (exercise: string): string => `Moved ${exercise} out of its section`;

/**
 * The routines' rate-limit sentence (`routines/messages.ts` `RATE_LIMITED`, which `workouts/` may not
 * import, 10.1 AC28), with the server's `Retry-After` when it sent one.
 */
export function rateLimited(retryAfterMs: number | null): string {
  if (retryAfterMs === null) return "Too many changes in a short time — wait a minute and try again";
  const n = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many changes in a short time — try again in ${n} ${n === 1 ? "second" : "seconds"}`;
}
