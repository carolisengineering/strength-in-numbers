/**
 * Spec 10.4 — every piece of the import screens' copy. Fixed text, tested by exact match; a message may
 * include a count or a name already on screen, never other pasted text (§6.6).
 */

// Check exercise names: the New card's name (CatalogName's rule, in the app's wording).
export const NEW_NAME_REQUIRED = "Give the exercise a name";
export const NEW_NAME_TOO_LONG = "Keep the name to 120 characters or fewer";
export const NEW_NAME_INVALID = "Remove unusual characters from the name";

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
