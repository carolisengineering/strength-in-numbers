import { ROUTINE_SECTIONS_MAX, SECTION_NAME_MAX } from "../dto/routine-section.js";
import type { Modality, UnitPreference } from "../enums.js";
import { cleanLine, cleanNotes } from "./importText.js";
import { sectionFromPlaceholder } from "./sections.js";
import type { HevyPair } from "./types.js";

/**
 * Spec 19.1: what the workout and routine translators share. Internal: the barrel re-exports only the two context
 * types, through `importWorkout.ts`.
 */

/** What the import knows about one of the caller's SIN exercises. */
export interface ImportExerciseInfo {
  name: string;
  modality: Modality;
  active: boolean;
  /** The lineage root: `COALESCE(forked_from_exercise_id, id)`. */
  rootId: string;
}

/** Loaded once per request (§6.1): the mapping by Hevy template id, the exercises by SIN id, the unit, the clock. */
export interface HevyImportContext {
  pairs: ReadonlyMap<string, HevyPair>;
  exercises: ReadonlyMap<string, ImportExerciseInfo>;
  unit: UnitPreference;
  now: Date;
}

type PairLookup = Pick<HevyImportContext, "pairs" | "exercises">;

/** The SIN exercise an `exercise` pair points at, or `null` when the pair cannot be used (AC4). */
export function usableExercise(pair: HevyPair | undefined, ctx: PairLookup): ImportExerciseInfo | null {
  if (pair === undefined || pair.role !== "exercise") return null;
  if (pair.exerciseId === null || pair.hevyType === null) return null;
  const info = ctx.exercises.get(pair.exerciseId);
  return info !== undefined && info.active ? info : null;
}

/** AC4: the template ids with no usable pair, each once, in first-seen order. */
export function unpairedTemplateIds(templateIds: Iterable<string>, ctx: PairLookup): string[] {
  const out = new Set<string>();
  for (const id of templateIds) {
    const pair = ctx.pairs.get(id);
    if (pair !== undefined && pair.role !== "exercise") continue;
    if (usableExercise(pair, ctx) === null) out.add(id);
  }
  return [...out];
}

/**
 * AC3 / AC11: the section a placeholder starts, through 19.0's `sectionFromPlaceholder`. Control characters are
 * removed first (the note keeps TAB, LF, CR; the name keeps none), because SIN's section schemas refuse them.
 */
export function placeholderSection(
  role: "warmup_placeholder" | "workout_placeholder",
  rawNotes: string | null,
): { name: string; notes: string | null; nameCut: boolean; notesCut: boolean } {
  // A lone CR splits a line like LF (minors 150, 211): `sectionFromPlaceholder` splits on CRLF, CR and LF.
  const notes = cleanNotes(rawNotes, Number.MAX_SAFE_INTEGER).value;
  const section = sectionFromPlaceholder(role, notes);
  return {
    name: cleanLine(section.name, SECTION_NAME_MAX).value ?? "Workout",
    notes: section.note,
    nameCut: section.notices.includes("section_name_cut"),
    notesCut: section.notices.includes("section_note_cut"),
  };
}

/** The section notices, shared by the workout and routine code lists. */
type SectionNoticeCode = "section_empty" | "sections_over_limit" | "section_name_trimmed" | "section_notes_trimmed";

/**
 * Walks placeholders into sections (AC3): a placeholder opens a section that is created only when a stored exercise
 * lands in it (else `section_empty`); past `ROUTINE_SECTIONS_MAX` a placeholder is ignored (`sections_over_limit`)
 * and the exercises after it stay in the last section. The trimmed notices are added by `keep`, for the sections
 * that are stored (minor 148: the routine item cap can still remove a section).
 */
export class SectionWalk {
  readonly sections: { name: string; notes: string | null }[] = [];
  private readonly cuts: { nameCut: boolean; notesCut: boolean }[] = [];
  private open: ReturnType<typeof placeholderSection> | null = null;
  private current: number | null = null;

  constructor(private readonly notices: { add(code: SectionNoticeCode): void }) {}

  placeholder(role: "warmup_placeholder" | "workout_placeholder", rawNotes: string | null): void {
    if (this.open !== null) this.notices.add("section_empty");
    if (this.sections.length >= ROUTINE_SECTIONS_MAX) {
      this.notices.add("sections_over_limit");
      this.open = null;
      return;
    }
    this.open = placeholderSection(role, rawNotes);
  }

  /** The section index for a stored exercise, creating the open section if there is one. */
  place(): number | null {
    if (this.open !== null) {
      this.cuts.push({ nameCut: this.open.nameCut, notesCut: this.open.notesCut });
      this.sections.push({ name: this.open.name, notes: this.open.notes });
      this.current = this.sections.length - 1;
      this.open = null;
    }
    return this.current;
  }

  finish(): void {
    if (this.open !== null) this.notices.add("section_empty");
    this.open = null;
  }

  /** The trimmed notices of the sections that are stored, by index into `sections`. */
  keep(indexes: Iterable<number>): void {
    for (const index of indexes) {
      const cut = this.cuts[index]!;
      if (cut.nameCut) this.notices.add("section_name_trimmed");
      if (cut.notesCut) this.notices.add("section_notes_trimmed");
    }
  }
}
