import { noControlChars, noControlCharsExceptWhitespace, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "@sin/core";
import {
  SECTION_NAME_INVALID,
  SECTION_NAME_REQUIRED,
  SECTION_NAME_TOO_LONG,
  SECTION_NOTES_INVALID,
  SECTION_NOTES_TOO_LONG,
} from "./messages";
import type { Parsed } from "./targetFormat";

const length = (text: string): number => Array.from(text).length; // code points, as Zod 4's .max() counts

/** A section name as the sheet and the Add-section field parse it (AC8): trimmed, 1–40 code points, no control characters. */
export function parseSectionName(text: string): Parsed<string> {
  const t = text.trim();
  if (t === "") return { ok: false, message: SECTION_NAME_REQUIRED };
  if (length(t) > SECTION_NAME_MAX) return { ok: false, message: SECTION_NAME_TOO_LONG };
  if (!noControlChars(t)) return { ok: false, message: SECTION_NAME_INVALID };
  return { ok: true, value: t };
}

/** A section note: returned exactly as typed (so Done on an untouched sheet changes nothing); `toRoutineInput` trims it. */
export function parseSectionNotes(text: string): Parsed<string> {
  const t = text.trim();
  if (length(t) > SECTION_NOTES_MAX) return { ok: false, message: SECTION_NOTES_TOO_LONG };
  if (!noControlCharsExceptWhitespace(t)) return { ok: false, message: SECTION_NOTES_INVALID };
  return { ok: true, value: text };
}
