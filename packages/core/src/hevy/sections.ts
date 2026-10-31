import { SECTION_NAME_MAX, SECTION_NOTES_MAX } from "../dto/routine-section.js";
import { cutClusters } from "./clusterCut.js";
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

function noteOf(lines: readonly string[], notices: SectionNotice[]): string | null {
  const note = lines
    .map((line) => line.trim())
    .join("\n")
    .trim();
  if (note === "") return null;
  if (note.length <= SECTION_NOTES_MAX) return note;
  notices.push("section_note_cut");
  // A cut keeps whole clusters, so one cluster longer than the limit leaves nothing: no note, never "".
  return cutClusters(note, SECTION_NOTES_MAX).trimEnd() || null;
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
  // Minor 211: CRLF, a lone CR and LF each end a line.
  const lines = (notes ?? "").split(/\r\n?|\n/);
  if (role === "warmup_placeholder") return { name: "Warm-up", note: noteOf(lines, notices), notices };

  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return { name: "Workout", note: null, notices };
  let name = lines[first]!.trim();
  if (name.length > SECTION_NAME_MAX) {
    const kept = cutClusters(name, SECTION_NAME_MAX).trim();
    // Minor 214: a cut that keeps nothing replaces the name with Workout, which is not a trimmed name.
    if (kept !== "") notices.push("section_name_cut");
    name = kept || "Workout";
  }
  return { name, note: noteOf(lines.slice(first + 1), notices), notices };
}
