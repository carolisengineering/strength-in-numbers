import { SECTION_NAME_MAX, SECTION_NOTES_MAX } from "../dto/routine-section.js";
import type { SectionTreatment } from "./vocabulary.js";

/** A section rule: how sections with this name are sent to Hevy. */
export interface SectionRule {
  name: string;
  treatment: SectionTreatment;
}

/**
 * Spec 19.0 AC10: the rules that apply when the user has none for a name. Any other name is sent as a
 * `workout_placeholder`.
 */
export const SECTION_DEFAULT_RULES: readonly SectionRule[] = Object.freeze([
  Object.freeze({ name: "Warm-up", treatment: "warmup_placeholder" as const }),
  Object.freeze({ name: "Accessory", treatment: "notes_on_first" as const }),
]);

/** A section rule's match key: the trimmed, lowercased name (Phase B stores it as `name_key`). */
export function sectionKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Spec 19.0 AC10: the user's rule for this name, else the default, else `workout_placeholder`. */
export function sectionTreatment(name: string, rules: readonly SectionRule[]): SectionTreatment {
  const key = sectionKey(name);
  const own = rules.find((rule) => sectionKey(rule.name) === key);
  if (own) return own.treatment;
  return SECTION_DEFAULT_RULES.find((rule) => sectionKey(rule.name) === key)?.treatment ?? "workout_placeholder";
}

export type SectionNotice = "section_name_cut" | "section_note_cut";

const ZWJ = 0x200d;
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
/** A code point that continues the cluster before it: a combining mark, a variation selector, a skin-tone modifier. */
const EXTENDS = /^[\p{M}‍︀-️\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;

/** Whether a cut between `before` (code points kept) and `next` (the first one dropped) splits a cluster. */
function splitsCluster(before: readonly string[], next: string | undefined): boolean {
  if (before.length === 0) return false;
  const last = before[before.length - 1]!.codePointAt(0)!;
  if (last === ZWJ) return true;
  if (next === undefined) return false;
  if (EXTENDS.test(next)) return true;
  if (!isRegionalIndicator(last) || !isRegionalIndicator(next.codePointAt(0)!)) return false;
  let run = 0;
  for (let i = before.length - 1; i >= 0 && isRegionalIndicator(before[i]!.codePointAt(0)!); i--) run++;
  return run % 2 === 1;
}

/**
 * The longest prefix of at most `max` UTF-16 units (SIN's limits count units) that ends on a cluster boundary: never
 * inside a surrogate pair (deferred minor 136), after a ZWJ, before a combining mark, variation selector or skin-tone
 * modifier, or between a flag's two regional indicators (minor 146). No `Intl.Segmenter` (core stays pure), so it
 * may end a little shorter than a true grapheme cut; it is never longer.
 */
function cutUnits(text: string, max: number): string {
  const points = [...text];
  const kept: string[] = [];
  let units = 0;
  for (const p of points) {
    if (units + p.length > max) break;
    kept.push(p);
    units += p.length;
  }
  while (splitsCluster(kept, points[kept.length])) kept.pop();
  return kept.join("");
}

function noteOf(lines: readonly string[], notices: SectionNotice[]): string | null {
  const note = lines
    .map((line) => line.trim())
    .join("\n")
    .trim();
  if (note === "") return null;
  if (note.length <= SECTION_NOTES_MAX) return note;
  notices.push("section_note_cut");
  return cutUnits(note, SECTION_NOTES_MAX).trimEnd();
}

/**
 * Spec 19.0 AC10: the section a Hevy placeholder exercise starts on import. A warm-up marker is `Warm-up` with its
 * notes as the note; a workout marker is named by the first non-blank line of its notes (`Workout` when there is
 * none), the remaining lines, trimmed, being the note. Names and notes are cut to SIN's section limits, with a notice.
 */
export function sectionFromPlaceholder(
  role: "warmup_placeholder" | "workout_placeholder",
  notes: string | null,
): { name: string; note: string | null; notices: SectionNotice[] } {
  const notices: SectionNotice[] = [];
  const lines = (notes ?? "").split(/\r?\n/);
  if (role === "warmup_placeholder") return { name: "Warm-up", note: noteOf(lines, notices), notices };

  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return { name: "Workout", note: null, notices };
  let name = lines[first]!.trim();
  if (name.length > SECTION_NAME_MAX) {
    name = cutUnits(name, SECTION_NAME_MAX).trim();
    notices.push("section_name_cut");
  }
  return { name, note: noteOf(lines.slice(first + 1), notices), notices };
}
