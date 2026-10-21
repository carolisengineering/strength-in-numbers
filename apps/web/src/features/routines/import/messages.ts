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
