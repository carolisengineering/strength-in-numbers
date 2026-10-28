import {
  PLANNED_SETS_PER_ITEM_MAX,
  ROUTINE_ITEM_NOTES_MAX,
  ROUTINE_ITEMS_MAX,
  ROUTINE_NAME_MAX,
  ROUTINE_NOTES_MAX,
  ROUTINE_SECTIONS_MAX,
  SECTION_NAME_MAX,
  SECTION_NOTES_MAX,
  SUPERSET_GROUP_MEMBERS_MAX,
  type ImportNotice,
} from "@sin/core";

/**
 * Spec 10.4 — every piece of the import screens' copy. Fixed text, tested by exact match; a message may
 * include a count or a name already on screen, never other pasted text (§6.6).
 */

// Check exercise names: the New card's name (CatalogName's rule, in the app's wording). Shared with the Hevy
// pairing cards, so the text lives in catalog/newExerciseName.ts (Spec 20.0 D8).
export { NEW_NAME_INVALID, NEW_NAME_REQUIRED, NEW_NAME_TOO_LONG } from "../../catalog/newExerciseName";
/** A New card refused for something other than its name (type, muscles, equipment). Defensive: the fields prevent it today. */
export const NEW_DETAILS_INVALID = "Check this exercise's type and details";

// Paste screen (AC21, §5.2).
export const PASTE_TITLE = "New routine from text";
export const TEXT_LABEL = "Workout text";
export const HOW_TO_INTRO = "Copy the text from your screenshots:";
export const HOW_TO_STEPS = [
  "In Photos, open the screenshot.",
  "Tap the Live Text button.",
  "Touch and hold the text, then tap Select All, then Copy.",
  "Paste it here. For more than one screenshot, paste them one after another, in order.",
] as const;
export const PRIVACY_LINE = "Your text is read on this phone. Nothing is saved until you tap Save in the editor.";
export const READ_BUTTON = "Read workout";
export const TOO_LONG = "That is a lot of text (over 40,000 characters). Paste fewer screenshots at a time.";

// Read outcomes with no exercises (AC22).
export const NO_EXERCISES = "No exercises found in this text";
export const NOTHING_TO_READ = "Nothing to read in this text";
export const OPEN_ANYWAY = "Open in the editor anyway";
/** Names only sections (a count and section names already on screen in the editor). */
export function foundLine(sections: readonly string[]): string {
  if (sections.length === 0) return "Found a note, but no sections.";
  return `Found ${sections.length} ${sections.length === 1 ? "section" : "sections"}: ${sections.join(", ")}`;
}

// Check exercise names (AC23–AC24, §5.3).
export const NAMES_TITLE = "Check exercise names";
export const BACK_TO_TEXT = "Back to text";
export const CATALOG_LOADING = "Loading your exercises…";
export const CATALOG_FAILED = "Couldn't load your exercises";
/** "Found 4 sections and 8 exercises from 5 screenshots"; "from K screenshots" only when K ≥ 2. */
export function summaryLine(sections: number, exercises: number, screenshots: number): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const from = screenshots >= 2 ? ` from ${screenshots} screenshots` : "";
  return `Found ${count(sections, "section", "sections")} and ${count(exercises, "exercise", "exercises")}${from}`;
}
export const IN_YOUR_LIST = "In your list";
export const SIMILAR = "Similar";
export const NOTHING_SIMILAR = "Nothing similar in your list.";
/** The card's current New name, else the written name when blank. */
export const newOption = (name: string) => `New: ${name}`;
export const usedIn = (sections: readonly string[]) => `Used in ${sections.join(", ")}`;
export const CHOOSE_ANOTHER = "Choose another exercise";
export const CHANGE = "Change";
export const TYPE_LABEL = "Type";
export const alreadyInList = (name: string) => `${name} is already in your list.`;
export const USE_IT_INSTEAD = "Use it instead";
export const SAME_NEW = "Another new exercise has this name";

// Continue (AC28).
export const CONTINUE = "Continue";
export const GO_TO_FIRST = "Go to the first one";
export const needAttention = (n: number) => (n === 1 ? "1 card needs attention" : `${n} cards need attention`);
export const EXERCISE_GONE = "That exercise is no longer in your list";

// The editor after import (AC30, AC34). Counts and caps come from the @sin/core constants.
export const IMPORTED_NOTICE = "Read from your text. Check the sections and notes, then add weights.";
export function importNoticeText(notice: ImportNotice): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("N", String(n)));
  switch (notice.code) {
    case "name-cut":
      return `The routine name was cut to ${ROUTINE_NAME_MAX} characters.`;
    case "routine-note-cut":
      return `The routine note was cut to ${ROUTINE_NOTES_MAX} characters.`;
    case "section-name-cut":
      return plural(notice.count, "A section name was", "N section names were") + ` cut to ${SECTION_NAME_MAX} characters.`;
    case "section-note-cut":
      return plural(notice.count, "A section note was", "N section notes were") + ` cut to ${SECTION_NOTES_MAX} characters.`;
    case "item-note-cut":
      return plural(notice.count, "A note was", "N notes were") + ` cut to ${ROUTINE_ITEM_NOTES_MAX} characters.`;
    case "sections-left-out":
      return `Only the first ${ROUTINE_SECTIONS_MAX} sections were kept. Left out: ${notice.names.join(", ")}.`;
    case "items-left-out":
      return `Only the first ${ROUTINE_ITEMS_MAX} exercises were kept. ` + plural(notice.count, "1 more was left out.", "N more were left out.");
    case "sets-cut":
      return `Only the first ${PLANNED_SETS_PER_ITEM_MAX} sets were kept for ${notice.names.join(", ")}.`;
    case "superset-split":
      return plural(notice.count, "A superset", "N supersets") + ` of more than ${SUPERSET_GROUP_MEMBERS_MAX} exercises ` + plural(notice.count, "was", "were") + " split.";
  }
}

// Save (AC32).
/** Names the exercise the owner chose on its card (already on screen), never other pasted text. */
export const createFailed = (name: string) => `Couldn't create “${name}”. The routine wasn't saved.`;
