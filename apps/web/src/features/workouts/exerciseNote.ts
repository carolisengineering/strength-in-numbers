import { noControlCharsExceptWhitespace, ROUTINE_ITEM_NOTES_MAX } from "@sin/core";
import { NOTES_MESSAGE, type Parsed } from "../routines/targetFormat";

/**
 * The session note's cap (Spec 10.3 D6): the routine item note's 500, although the API accepts 4 000 — a long note
 * under a card pushes the Log row off a phone screen. One constant; a longer value written elsewhere displays in
 * full and is edited down on save.
 */
export const EXERCISE_NOTE_MAX = ROUTINE_ITEM_NOTES_MAX;

/** Blank = clear (`null`). Counted in code points, like the server's `.max()`; static message, never the input. */
export function parseExerciseNote(text: string): Parsed<string | null> {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (Array.from(t).length > EXERCISE_NOTE_MAX) return { ok: false, message: NOTES_MESSAGE };
  if (!noControlCharsExceptWhitespace(t)) return { ok: false, message: NOTES_MESSAGE };
  return { ok: true, value: t };
}
