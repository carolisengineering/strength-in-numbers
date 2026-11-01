/**
 * Spec 10.4 AC17 / §6.6 — pure: turns a `ReadResult` and the chosen exercises' modalities into a
 * routine plan within `RoutineWriteSchema`'s bounds. Every cut is reported as a notice code (#57:
 * the web maps codes to static copy; no message text here). No I/O, no DOM, no Node APIs.
 */
import { forbiddenMeasuresFor } from "./dto/set-entry.js";
import { PLANNED_SETS_PER_ITEM_MAX } from "./dto/planned-set.js";
import { ROUTINE_SECTIONS_MAX, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "./dto/routine-section.js";
import { ROUTINE_ITEM_NOTES_MAX, ROUTINE_ITEMS_MAX, ROUTINE_NAME_MAX, ROUTINE_NOTES_MAX, SUPERSET_GROUP_MEMBERS_MAX } from "./dto/routine.js";
import type { Modality } from "./enums.js";
import type { ReadItem, ReadResult, ReadRow } from "./workoutText.js";

export type ImportNotice =
  | { readonly code: "name-cut" | "routine-note-cut" }
  | {
      readonly code: "section-name-cut" | "section-note-cut" | "item-note-cut" | "items-left-out" | "superset-split";
      readonly count: number;
    }
  | { readonly code: "sections-left-out"; readonly count: number; readonly names: readonly string[] }
  | { readonly code: "sets-cut"; readonly names: readonly string[] };
export type ImportNoticeCode = ImportNotice["code"];

/** The §6.6 table order; notices are emitted in it, one per code. */
export const IMPORT_NOTICE_ORDER: readonly ImportNoticeCode[] = [
  "name-cut",
  "section-name-cut",
  "section-note-cut",
  "routine-note-cut",
  "item-note-cut",
  "sections-left-out",
  "items-left-out",
  "sets-cut",
  "superset-split",
];

export interface ImportPlanSection {
  readonly name: string;
  readonly notes: string | null;
}
export interface ImportPlanRow {
  readonly repsLow: number | null;
  readonly repsHigh: number | null;
}
export type ImportPlanForm =
  | { readonly kind: "quick"; readonly targetSets: number | null; readonly targetRepsLow: number | null; readonly targetRepsHigh: number | null }
  /** 1–20 rows, all working. */
  | { readonly kind: "plan"; readonly rows: readonly ImportPlanRow[] };
export interface ImportPlanItem {
  readonly nameKey: string;
  /** As written (notices name it). */
  readonly name: string;
  /** Index into `plan.sections`. */
  readonly section: number | null;
  /** 1, 2, 3 … by first appearance; 2–8 members; never spans a section. */
  readonly supersetGroup: number | null;
  readonly notes: string | null;
  readonly form: ImportPlanForm;
}
export interface ImportPlan {
  /** "" when the read found none. */
  readonly name: string;
  readonly notes: string | null;
  readonly sections: readonly ImportPlanSection[];
  /** Canonical order: loose, then section by section. */
  readonly items: readonly ImportPlanItem[];
  readonly notices: readonly ImportNotice[];
}

const ELLIPSIS = "…";

/**
 * The longest prefix of at most `max` UTF-16 units that ends on a grapheme boundary (never inside an emoji).
 * Built per cut, only when one is needed: a browser without `Intl.Segmenter` falls back to code points
 * instead of failing to load the package.
 */
function prefixAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const units =
    typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text), (s) => s.segment)
      : Array.from(text);
  let end = 0;
  for (const unit of units) {
    if (end + unit.length > max) break;
    end += unit.length;
  }
  return text.slice(0, end);
}

/** ≤ max UTF-16 units on a grapheme boundary; ends "…" (after no trailing whitespace) when cut. */
export function cutNote(text: string, max: number): string {
  return text.length <= max ? text : prefixAt(text, max - ELLIPSIS.length).trimEnd() + ELLIPSIS;
}

/** ≤ max UTF-16 units on a grapheme boundary, trimmed at the end; no "…". */
export function cutName(text: string, max: number): string {
  return text.length <= max ? text : prefixAt(text, max).trimEnd();
}

const repOk = (n: number | null) => n === null || (n >= 1 && n <= 100);
const rowOk = (r: ReadRow) => repOk(r.repsLow) && repOk(r.repsHigh);
const NO_REPS: ImportPlanRow = { repsLow: null, repsHigh: null };

interface Shaped {
  readonly form: ImportPlanForm;
  readonly noteLines: readonly string[];
  readonly setsCut: boolean;
}

/** Step 3: rows cut to 20, reps refused by the type or out of range, quick vs plan. */
function shape(item: ReadItem, modality: Modality): Shaped {
  const refusesReps = forbiddenMeasuresFor(modality).includes("reps");
  let noteLines = [...item.noteLines];
  // A refused `a/b` says it once: "10/10 reps as written" replaces the reader's "10/10" line.
  const asWritten = (text: string) => {
    noteLines = noteLines.filter((l) => l !== text);
    noteLines.push(`${text} reps as written`);
  };
  if (item.rows === null) {
    const reps = item.quickReps ?? NO_REPS;
    const refused = refusesReps || !rowOk(reps);
    if (refused && item.repsText !== null) asWritten(item.repsText);
    const r = refused ? NO_REPS : reps;
    return { form: { kind: "quick", targetSets: null, targetRepsLow: r.repsLow, targetRepsHigh: r.repsHigh }, noteLines, setsCut: false };
  }
  const setsCut = item.rows.length > PLANNED_SETS_PER_ITEM_MAX;
  const kept = item.rows.slice(0, PLANNED_SETS_PER_ITEM_MAX);
  const refused = refusesReps || !kept.every(rowOk);
  if (refused && item.repsText !== null) asWritten(item.repsText);
  const rows = kept.map((r) => (refused ? NO_REPS : { repsLow: r.repsLow, repsHigh: r.repsHigh }));
  const first = rows[0] ?? NO_REPS;
  const uniform = rows.every((r) => r.repsLow === first.repsLow && r.repsHigh === first.repsHigh);
  const form: ImportPlanForm = uniform
    ? { kind: "quick", targetSets: rows.length, targetRepsLow: first.repsLow, targetRepsHigh: first.repsHigh }
    : { kind: "plan", rows };
  return { form, noteLines, setsCut };
}

export function buildImportPlan(read: ReadResult, modalityOf: (nameKey: string) => Modality): ImportPlan {
  const found = new Map<ImportNoticeCode, ImportNotice>();
  const count = (code: "section-name-cut" | "section-note-cut" | "item-note-cut" | "items-left-out" | "superset-split", n = 1) => {
    const prev = found.get(code);
    found.set(code, { code, count: (prev && "count" in prev ? prev.count : 0) + n });
  };

  // (1) The first 8 sections; the rest leave with their exercises.
  if (read.sections.length > ROUTINE_SECTIONS_MAX) {
    const names = read.sections.slice(ROUTINE_SECTIONS_MAX).map((s) => s.name);
    found.set("sections-left-out", { code: "sections-left-out", count: names.length, names });
  }
  const inKeptSection = (it: ReadItem) => it.section === null || it.section < ROUTINE_SECTIONS_MAX;
  // The reader emits items loose first, then section by section (minor 22; pinned in the totality test). A read built
  // another way is put in that order too (minor 220): the sort is stable, so an ordered read comes back as it was (minor 282).
  const rank = (it: ReadItem) => it.section ?? -1;
  const surviving = read.items.filter(inKeptSection).sort((a, b) => rank(a) - rank(b));

  // (2) The first 30 items.
  if (surviving.length > ROUTINE_ITEMS_MAX) count("items-left-out", surviving.length - ROUTINE_ITEMS_MAX);
  const items = surviving.slice(0, ROUTINE_ITEMS_MAX);

  // (3)–(4) Per item: rows, reps, form, note.
  const setsCut: string[] = [];
  const shaped = items.map((it) => {
    const s = shape(it, modalityOf(it.nameKey));
    if (s.setsCut && !setsCut.includes(it.name)) setsCut.push(it.name);
    const joined = s.noteLines.join("\n");
    const notes = cutNote(joined, ROUTINE_ITEM_NOTES_MAX);
    if (notes !== joined) count("item-note-cut");
    return { it, form: s.form, notes: notes === "" ? null : notes };
  });
  if (setsCut.length > 0) found.set("sets-cut", { code: "sets-cut", names: setsCut });

  // (5) Groups: a run's surviving members, in chunks of 8; a chunk of one is ungrouped.
  const groupOf = new Array<number | null>(shaped.length).fill(null);
  const runs = new Map<number, number[]>();
  shaped.forEach(({ it }, i) => {
    if (it.run === null) return;
    runs.set(it.run, [...(runs.get(it.run) ?? []), i]);
  });
  // Groups are numbered by each run's first appearance (the map keeps insertion order); the reader keeps a run's
  // members consecutive, so its chunks are in item order too.
  const chunks: number[][] = [];
  for (const members of runs.values()) {
    if (members.length > SUPERSET_GROUP_MEMBERS_MAX) count("superset-split");
    for (let c = 0; c < members.length; c += SUPERSET_GROUP_MEMBERS_MAX) {
      const chunk = members.slice(c, c + SUPERSET_GROUP_MEMBERS_MAX);
      if (chunk.length >= 2) chunks.push(chunk);
    }
  }
  chunks.forEach((chunk, g) => chunk.forEach((i) => (groupOf[i] = g + 1)));

  // (6) Names and notes of the routine and its sections.
  const sections = read.sections.slice(0, ROUTINE_SECTIONS_MAX).map((s) => {
    const name = cutName(s.name, SECTION_NAME_MAX);
    if (name !== s.name) count("section-name-cut");
    const notes = cutNote(s.notes, SECTION_NOTES_MAX);
    if (notes !== s.notes) count("section-note-cut");
    return { name, notes: notes === "" ? null : notes };
  });
  const name = cutName(read.name ?? "", ROUTINE_NAME_MAX);
  if (name !== (read.name ?? "")) found.set("name-cut", { code: "name-cut" });
  const notes = cutNote(read.notes, ROUTINE_NOTES_MAX);
  if (notes !== read.notes) found.set("routine-note-cut", { code: "routine-note-cut" });

  return {
    name,
    notes: notes === "" ? null : notes,
    sections,
    items: shaped.map(({ it, form, notes: itemNotes }, i) => ({
      nameKey: it.nameKey,
      name: it.name,
      section: it.section,
      supersetGroup: groupOf[i]!,
      notes: itemNotes,
      form,
    })),
    notices: IMPORT_NOTICE_ORDER.flatMap((code) => (found.has(code) ? [found.get(code)!] : [])),
  };
}
