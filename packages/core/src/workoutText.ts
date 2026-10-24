/**
 * Spec 10.4 §6.1 — pure reader for pasted Live Text (a gym app's workout screenshots). Cleaning
 * chunks the paste at status-bar clock lines, drops exact furniture lines and removes the overlap
 * between consecutive screenshots. Every function is total and linear: anchored patterns, no
 * nested quantifiers. No I/O, no DOM, no Node APIs.
 */
import { normalizeExerciseName } from "./exerciseMatch.js";

/** The paste box's limit (Phase B); the reader itself accepts any length. */
export const IMPORT_TEXT_MAX = 40_000;

/** A status-bar time; AC42: optionally one icon after it (a space and ≤ 3 characters with no letter or digit). */
export const CLOCK_LINE = /^\d{1,2}:\d{2}(?: ?[AP]M)?(?: [^\p{L}\p{N}\s]{1,3})?$/iu;
export const RESULTS_LINE = /^RESULTS \(\d{1,6}\)$/i;
export const BADGE_LINES: readonly string[] = ["NO SCORE", "WEIGHT", "TIME", "REPS", "ROUNDS", "DISTANCE", "CALORIES", "LOAD", "Log result"];
export const GYM_LINES: readonly string[] = ["HIRAYA TRAINING HOUSE", "HIRAYA", "TRAINING HOUSE"];
export const NAV_LINES: readonly string[] = ["Home", "Schedule", "Workouts", "Social"];

/** AC45: the badges that sit beside a section header ("Log result" is a button, not a badge). */
const HEADER_BADGES = new Set(BADGE_LINES.filter((l) => l !== "Log result").map((l) => l.toLowerCase()));
const FURNITURE = new Set([...BADGE_LINES, ...GYM_LINES, ...NAV_LINES].map((l) => l.toLowerCase()));
// C0 controls, DEL, C1 controls and the zero-width space / word joiner; `\s` covers NBSP and BOM.
// eslint-disable-next-line no-control-regex -- turning control characters into spaces is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b\u2060]/g;
const LINE_BREAK = /\r\n|\r|\n/;
const ALNUM = /[\p{L}\p{N}]/u;
const LATIN_OR_DIGIT = /[A-Za-z0-9\u00C0-\u024F]/;
/** The signal-strength bars as Live Text reads them: a dot, then up to three bar-like characters. */
const SIGNAL_BARS = /^[•·][•·.0oOlI|]{0,3}$/;
const BARE_NUMBER = /^\d{1,6}$/;

/** Control characters become spaces, whitespace runs collapse to one space, ends trimmed. */
export function collapseLine(line: string): string {
  return line.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

/** Screen icons read as text are short; a longer line with no Latin letter is someone's text (a note in another script). */
const ICON_MAX_LENGTH = 8;

/** AC43: a status-bar or tab-bar icon read as text: a short line with no Latin letter or digit, or the signal bars. */
export function isIconLine(line: string): boolean {
  const l = collapseLine(line);
  return l !== "" && l.length <= ICON_MAX_LENGTH && (!LATIN_OR_DIGIT.test(l) || SIGNAL_BARS.test(l));
}

export function isFurnitureLine(line: string): boolean {
  const l = collapseLine(line);
  return CLOCK_LINE.test(l) || RESULTS_LINE.test(l) || FURNITURE.has(l.toLowerCase()) || isIconLine(l);
}

const LOOK_ALIKES: Readonly<Record<string, string>> = { "0": "o", "9": "g", "1": "l", "|": "l", "5": "s" };
/** AC44: the overlap compares lines through this key, so Live Text's look-alike misreads ("90s" / "g0s" / "gos") still match. */
export function ocrKey(line: string): string {
  return collapseLine(line).toLowerCase().replace(/[0915|]/g, (c) => LOOK_ALIKES[c]!);
}

export interface CleanResult {
  /** Collapsed, non-empty, furniture and overlap removed, in order. */
  readonly lines: readonly string[];
  /** Chunks left after dropping those that clean to nothing. */
  readonly chunks: number;
  /** Non-empty input lines. */
  readonly input: number;
  /** Dropped as furniture (clock lines included). */
  readonly furniture: number;
  /** Removed as boundary overlap (a dropped partial line included). */
  readonly overlap: number;
  /** AC45: parallel to `lines`; true for a line directly above a header badge in its own screenshot. */
  readonly tagged: readonly boolean[];
}

const wordCount = (s: string) => s.split(" ").length;
/** The character just outside a fragment is not a letter or digit (a space, a comma, nothing). */
const boundaryAt = (s: string, i: number) => i < 0 || i >= s.length || !ALNUM.test(s[i]!);

/** `frag` is the end of `line`, starting at a word boundary, ≥ 2 words. */
function isSuffixFragment(line: string, frag: string): boolean {
  return frag.length < line.length && wordCount(frag) >= 2 && line.endsWith(frag) && boundaryAt(line, line.length - frag.length - 1);
}

/** `frag` is the start of `line`, ending at a word boundary, ≥ 2 words. */
function isPrefixFragment(line: string, frag: string): boolean {
  return frag.length < line.length && wordCount(frag) >= 2 && line.startsWith(frag) && boundaryAt(line, frag.length);
}

/**
 * AC4: the largest k for which A's last k lines repeat B's first k (the first pair may be B's
 * suffix fragment, the last pair A's cut-off prefix). Returns how many lines to drop from A's end
 * (0 or 1) and from B's start, or null when nothing overlaps.
 */
function overlapAt(a: readonly string[], b: readonly string[]): { dropA: number; dropB: number } | null {
  for (let k = Math.min(a.length, b.length); k >= 1; k--) {
    const off = a.length - k;
    const firstA = a[off]!;
    const firstB = b[0]!;
    const lastA = a[a.length - 1]!;
    const lastB = b[k - 1]!;
    if (k === 1) {
      if (firstA === firstB || isSuffixFragment(firstA, firstB)) return { dropA: 0, dropB: 1 };
      if (isPrefixFragment(firstB, firstA)) return { dropA: 1, dropB: 0 };
      continue;
    }
    // The first pair is the cheap check, so most k fail before the O(k) middle scan.
    if (firstA !== firstB && !isSuffixFragment(firstA, firstB)) continue;
    let middle = true;
    for (let j = 1; j < k - 1 && middle; j++) middle = a[off + j] === b[j];
    if (!middle) continue;
    if (lastA === lastB) return { dropA: 0, dropB: k };
    if (isPrefixFragment(lastB, lastA)) return { dropA: 1, dropB: k - 1 };
  }
  return null;
}

interface CleanLine {
  readonly text: string;
  tagged: boolean;
}

export function cleanWorkoutText(raw: string): CleanResult {
  let input = 0;
  let furniture = 0;
  let previous = "";
  const chunks: CleanLine[][] = [[]];
  for (const rawLine of raw.split(LINE_BREAK)) {
    const line = collapseLine(rawLine);
    if (line === "") continue;
    input++;
    const after = previous;
    previous = line;
    const chunk = chunks[chunks.length - 1]!;
    if (CLOCK_LINE.test(line)) {
      furniture++;
      chunks.push([]);
      continue;
    }
    if (HEADER_BADGES.has(line.toLowerCase())) {
      // A badge that opens a screenshot belongs to the header that ended the one before.
      const before = chunk.length > 0 ? chunk : [...chunks].reverse().find((c) => c.length > 0);
      const above = before?.[before.length - 1];
      if (above) above.tagged = true;
    }
    // AC43: a results count ("RESULTS (2)" then "49") is screen furniture too.
    if (isFurnitureLine(line) || (BARE_NUMBER.test(line) && RESULTS_LINE.test(after))) {
      furniture++;
      continue;
    }
    chunk.push({ text: line, tagged: false });
  }
  const kept = chunks.filter((c) => c.length > 0);
  // A strict header cut off at a screenshot's bottom edge (its badge out of frame) still heads its section.
  for (const c of kept.slice(0, -1)) {
    const last = c[c.length - 1]!;
    if (isStrictHeading(last.text)) last.tagged = true;
  }
  let overlap = 0;
  for (let i = 1; i < kept.length; i++) {
    let p = i - 1;
    while (p > 0 && kept[p]!.length === 0) p--;
    const a = kept[p]!;
    const b = kept[i]!;
    if (a.length === 0) continue;
    const cut = overlapAt(
      a.map((l) => ocrKey(l.text)),
      b.map((l) => ocrKey(l.text)),
    );
    if (cut === null) continue;
    // A removed twin hands its header tag to the copy that stays (a header whose badge was cut off).
    const off = a.length - cut.dropA - cut.dropB;
    for (let j = 0; j < cut.dropB; j++) if (b[j]!.tagged) a[off + j]!.tagged = true;
    a.splice(a.length - cut.dropA, cut.dropA);
    b.splice(0, cut.dropB);
    overlap += cut.dropA + cut.dropB;
  }
  const flat = kept.flat();
  return { lines: flat.map((l) => l.text), tagged: flat.map((l) => l.tagged), chunks: kept.length, input, furniture, overlap };
}

// ---------------------------------------------------------------------------------------------
// Reading (AC5–AC13): one pass over the cleaned lines with a small state machine.

export const HEADING_WORDS: readonly string[] = [
  "Warmup", "Warm-up", "Warm up", "Strength", "Accessory", "Accessories", "Conditioning", "Metcon", "Finisher",
  "Cooldown", "Cool down", "Core", "Skill", "Mobility", "Gymnastics",
];

/** Name uncut; notes "\n"-joined, "" = none. */
export interface ReadSection {
  readonly name: string;
  readonly notes: string;
  readonly warmup: boolean;
}
export interface ReadRow {
  readonly repsLow: number | null;
  readonly repsHigh: number | null;
}
export interface ReadItem {
  /** The exercise text as written. */
  readonly name: string;
  readonly nameKey: string;
  /** Index into `sections`; null = loose (preamble). */
  readonly section: number | null;
  /** null = rowless (a bare bulleted line). */
  readonly rows: readonly ReadRow[] | null;
  /** Rowless only: the line's rep range. */
  readonly quickReps: ReadRow | null;
  /** The reps as written: "21-15-9", "10", "10-15", "10/10"; set lines "6-6-4-4-10-10". */
  readonly repsText: string | null;
  readonly noteLines: readonly string[];
  /** Items sharing a run id are a superset candidate. */
  readonly run: number | null;
}
export interface ReadName {
  readonly key: string;
  readonly written: string;
  /** Names of the sections using it (loose omitted). */
  readonly sections: readonly string[];
}
export type LinePlacement = "heading" | "set-line" | "scheme" | "lead-in" | "separator" | "movement" | "note";
export interface ReadResult {
  /** Routine name, uncut. */
  readonly name: string | null;
  /** Routine note (preamble), "" = none. */
  readonly notes: string;
  readonly sections: readonly ReadSection[];
  readonly items: readonly ReadItem[];
  /** Distinct by key, first appearance. */
  readonly names: readonly ReadName[];
  readonly chunks: number;
  readonly lines: {
    readonly input: number;
    readonly furniture: number;
    readonly overlap: number;
    readonly placed: readonly { readonly text: string; readonly as: LinePlacement }[];
  };
}

// The title must hold a non-space character: `Workout: " "` is a note, like `Workout: ""`.
const WORKOUT_TITLE = /^workout\s*:\s*["“”]\s*(\S(?:.*\S)?)\s*["“”]$/i;
const HEADING_SET = new Set(HEADING_WORDS.map((w) => w.toLowerCase()));
const WARMUP = /^warm[\s-]?up$/i;
const TITLE_PUNCTUATION = /[:.!?,;]/;
const DIGIT = /\d/;
const LETTER = /\p{L}/u;
const UPPER_START = /^\p{Lu}/u;
const LEADING_BULLET_MARK = /^[-•*]/;

interface MutableSection {
  name: string;
  notes: string[];
  warmup: boolean;
  strength: MutableItem | null;
  /** AC47: no line has been placed under the header yet. */
  fresh: boolean;
  /** AC52: a variant label was seen; the rest of the section is note. */
  notesOnly: boolean;
}
interface MutableItem {
  name: string;
  nameKey: string;
  section: number | null;
  rows: ReadRow[] | null;
  quickReps: ReadRow | null;
  repsText: string | null;
  noteLines: string[];
  run: number | null;
}
type Run = { id: number; kind: "scheme"; reps: number[]; text: string } | { id: number; kind: "lead-in"; n: number };

/** AC5 (c): a short title-cased line with no digit or sentence punctuation. */
function isGenericTitle(line: string): boolean {
  if (line.length > 40 || !LETTER.test(line) || DIGIT.test(line) || TITLE_PUNCTUATION.test(line) || LEADING_BULLET_MARK.test(line)) return false;
  const words = line.split(" ");
  if (words.length > 5) return false;
  if (line === line.toUpperCase()) return true;
  const firstLetter = line.match(/\p{L}/u)![0];
  if (!UPPER_START.test(firstLetter)) return false;
  return words.every((w) => (w.match(/\p{L}/gu)?.length ?? 0) < 4 || UPPER_START.test(w));
}

/** A `Workout: "X"` title or a known section word: a header even without its badge. */
function isStrictHeading(line: string): boolean {
  const bare = line.endsWith(":") ? line.slice(0, -1).trimEnd() : line;
  return WORKOUT_TITLE.test(line) || HEADING_SET.has(bare.toLowerCase());
}

/** The section a heading line starts, or null. `listOpen` turns off generic titles (AC5). */
function headingOf(line: string, last: boolean, listOpen: boolean): { name: string; workout: boolean } | null {
  const titled = WORKOUT_TITLE.exec(line);
  if (titled) return { name: titled[1]!, workout: true };
  const bare = line.endsWith(":") ? line.slice(0, -1).trimEnd() : line;
  if (HEADING_SET.has(bare.toLowerCase())) return { name: bare, workout: false };
  if (!last && !listOpen && isGenericTitle(line)) return { name: line, workout: false };
  return null;
}

interface ReadState {
  sections: MutableSection[];
  items: MutableItem[];
  routineNotes: string[];
  section: number | null;
  run: Run | null;
  runs: number;
}

const SET_LINE = /^set\s+(\d{1,3})\s*:\s*(\d{1,4})\s+reps?(?:\s*@\s*(.+))?$/i;
const SCHEME = /^\d{1,4}(?:\s*[-–]\s*\d{1,4})+$/;
const LEAD_IN_SETS = /^(\d{1,2})\s+sets?:?$/i;
const LEAD_IN_ROUNDS = /^(?:then,?\s+)?(\d{1,2})\s+rounds?:?$/i;
const SEPARATOR = /^(?:directly into|into|then):$/i;
const BULLET = /^[-•*]\s*/;
const MOVEMENT_PUNCTUATION = /[:.!?;]/;
const RANGE_FORM = /^(\d{1,3})\s*[-–]\s*(\d{1,3})\s+(.+)$/;
const SPLIT_FORM = /^(\d{1,3})\/(\d{1,3})\s+(.+)$/;
const REPS_FORM = /^(\d{1,3})\s+(.+)$/;
const UNIT_WORD = /^(?:m|meters?|km|mi|miles?|min|minutes?|sec|seconds?|s|cal|calories?)$/i;
/** AC48: "3 Sets, 1 Set Every 4:00" — a set count with more after a comma. */
const LEAD_IN_SETS_EVERY = /^(\d{1,2})\s+sets?\s*,\s*\S.*$/i;
/** AC49: interval lines that describe the work, not a movement. */
const WORK_REST = /^(?:\d{1,3}x\s+)?\d{1,3}(?::\d{2})?s?\s+on\s*\/\s*\d{1,3}(?::\d{2})?s?\s+rest$/i;
const REST_LINE = /^rest\b/i;
/**
 * AC50: "Max Cal Echo Bike with remaining time" — name the movement, keep the rest as its note. Linear only on
 * collapsed lines (single spaces): the lazy name before an optional suffix is quadratic over a long whitespace run.
 */
const MAX_LINE = /^(max(?:\s+(?:cal|calories|reps))?)\s+(\S.*?)(?:\s+(with\s+(?:the\s+)?remaining\s+time))?$/i;
/** AC51: "10 Tuckups + 15 Hollow Rocks". */
const PLUS = /\s\+\s/;
const LEADING_MEASURE = /^(\d{1,6}(?:[.,]\d{1,3})?\s?(?:m|meters?|km|mi|miles?|min|minutes?|sec|seconds?|s|cal|calories?))(?:\s|$)/i;

/** A leading rep form (AC9): reps for every set, the text as written, and a note for `a/b`. */
interface RepForm {
  readonly reps: ReadRow;
  readonly text: string;
  readonly name: string;
  readonly note: string | null;
}

function repFormOf(text: string): RepForm | null {
  const named = (rest: string) => LETTER.test(rest) && !UNIT_WORD.test(rest.split(" ")[0]!);
  const range = RANGE_FORM.exec(text);
  if (range) {
    const [lo, hi, rest] = [Number(range[1]), Number(range[2]), range[3]!];
    return lo >= 1 && lo <= hi && hi <= 100 && named(rest) ? { reps: { repsLow: lo, repsHigh: hi }, text: `${lo}-${hi}`, name: rest, note: null } : null;
  }
  const split = SPLIT_FORM.exec(text);
  if (split) {
    const [a, b, rest] = [Number(split[1]), Number(split[2]), split[3]!];
    const t = `${a}/${b}`;
    return a >= 1 && b >= 1 && a + b <= 100 && named(rest) ? { reps: { repsLow: a + b, repsHigh: a + b }, text: t, name: rest, note: t } : null;
  }
  const one = REPS_FORM.exec(text);
  if (one) {
    const [r, rest] = [Number(one[1]), one[2]!];
    return r >= 1 && r <= 100 && named(rest) ? { reps: { repsLow: r, repsHigh: r }, text: String(r), name: rest, note: null } : null;
  }
  return null;
}

function leadInCount(line: string): number | null {
  const m = LEAD_IN_SETS.exec(line) ?? LEAD_IN_ROUNDS.exec(line);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

/** AC8: ≤ 6 words, ≤ 60 characters, a letter, no colon or sentence punctuation, not a lead-in or scheme. */
function isMovementText(text: string): boolean {
  return (
    text.length <= 60 && text.split(" ").length <= 6 && LETTER.test(text) && !MOVEMENT_PUNCTUATION.test(text) &&
    leadInCount(text) === null && !SCHEME.test(text)
  );
}

function pushItem(s: ReadState, item: Omit<MutableItem, "nameKey" | "section">): void {
  s.items.push({ ...item, nameKey: normalizeExerciseName(item.name), section: s.section });
}

/** One movement under an open run (AC8–AC11): rows from the run, the rep form or leading distance as its note. */
function pushMovement(s: ReadState, run: Run, text: string, form: RepForm | null, extraNotes: readonly string[] = []): void {
  const noteLines: string[] = [];
  let name = text;
  if (form) {
    name = form.name;
    if (run.kind === "scheme") noteLines.push(form.text);
    else if (form.note) noteLines.push(form.note);
  } else {
    const measure = LEADING_MEASURE.exec(text);
    if (measure) noteLines.push(measure[1]!);
  }
  noteLines.push(...extraNotes);
  const rows =
    run.kind === "scheme"
      ? run.reps.map((r) => ({ repsLow: r, repsHigh: r }))
      : Array.from({ length: run.n }, () => form?.reps ?? { repsLow: null, repsHigh: null });
  pushItem(s, { name, rows, quickReps: null, repsText: run.kind === "scheme" ? run.text : (form?.text ?? null), noteLines, run: run.id });
}

/** Steps 3–8: place the line as a construct ("note" keeps it in the note with the run open), or null to leave it to the note. */
function readConstruct(line: string, s: ReadState): LinePlacement | null {
  const section = s.section === null ? null : s.sections[s.section]!;

  // 3. Set lines: one strength item per section, named by the section's title (AC7).
  const set = section ? SET_LINE.exec(line) : null;
  if (set && section) {
    s.run = null;
    const reps = Number(set[2]);
    if (!section.strength) {
      pushItem(s, { name: section.name, rows: [], quickReps: null, repsText: null, noteLines: [], run: null });
      section.strength = s.items[s.items.length - 1]!;
    }
    const item = section.strength;
    item.rows!.push({ repsLow: reps, repsHigh: reps });
    item.repsText = item.rows!.map((r) => r.repsLow).join("-");
    if (set[3] !== undefined) item.noteLines.push(`Set ${Number(set[1])} @ ${set[3]}`);
    return "set-line";
  }

  // 4. A scheme opens a run (AC8).
  if (SCHEME.test(line)) {
    const reps = line.split(/\s*[-–]\s*/).map(Number);
    s.run = { id: ++s.runs, kind: "scheme", reps, text: reps.join("-") };
    return "scheme";
  }

  // 5. A lead-in opens a run of N sets (AC9); "N Sets, 1 Set Every M:SS" also stays in the note (AC48).
  const every = LEAD_IN_SETS_EVERY.exec(line);
  if (every && Number(every[1]) >= 1) {
    s.run = { id: ++s.runs, kind: "lead-in", n: Number(every[1]) };
    return "note";
  }
  const n = leadInCount(line);
  if (n !== null) {
    s.run = { id: ++s.runs, kind: "lead-in", n };
    return "lead-in";
  }

  // 6. A separator closes the open run.
  if (SEPARATOR.test(line)) {
    if (s.run === null) return null;
    s.run = null;
    return "separator";
  }

  // 7. A movement under an open run (AC8–AC11, AC49–AC51).
  if (s.run !== null) {
    const raw = line.replace(BULLET, "");
    // AC49: lines that describe the interval go to the note and keep the run open.
    if (WORK_REST.test(raw) || raw.endsWith(",") || REST_LINE.test(raw)) return "note";
    // AC51: "A + B" with a rep form on every side is one exercise per side.
    const parts = raw.split(PLUS);
    if (parts.length > 1 && parts.every((p) => isMovementText(p) && repFormOf(p) !== null)) {
      for (const part of parts) pushMovement(s, s.run, part, repFormOf(part));
      return "movement";
    }
    // AC50: "Max Cal X with remaining time" → X, with "Max Cal, with remaining time" as its note.
    const max = MAX_LINE.exec(raw);
    if (max && isMovementText(max[2]!)) {
      const note = [max[1]!, max[3]].filter((x): x is string => x !== undefined).join(", ");
      pushMovement(s, s.run, max[2]!, null, [note]);
      return "movement";
    }
    const text = raw.endsWith("+") ? raw.slice(0, -1).trimEnd() : raw;
    if (!isMovementText(text)) return null;
    pushMovement(s, s.run, text, repFormOf(text));
    return "movement";
  }

  // 8. A bare bullet with a rep form is a rowless item (AC10).
  if (BULLET.test(line)) {
    const form = repFormOf(line.replace(BULLET, ""));
    if (!form) return null;
    pushItem(s, { name: form.name, rows: null, quickReps: form.reps, repsText: form.text, noteLines: form.note ? [form.note] : [], run: null });
    return "movement";
  }
  return null;
}

/** AC52: the first words that name an alternative version of the workout (lowercase). */
const VARIANT_WORDS = new Set([
  "scaled", "scale", "outdoor", "outdoors", "indoor", "modified", "beginner", "intermediate", "advanced",
  "alternative", "alternatives", "option", "options", "sub", "subs", "substitute", "rx", "intent", "travel", "home",
]);
const NON_LABEL = /^non[- ]/i;
const AT_HOME = /^at home\b/i;
const PARENTHESIZED = /^\(.*\)$/;
const FIRST_WORD = /^[\p{L}]+/u;

/** AC52: a line that starts an alternative (scaled, at home, "(No Bike)"); format lines like "For Time:" are not. */
function isVariantLabel(line: string): boolean {
  if (NON_LABEL.test(line) || AT_HOME.test(line) || PARENTHESIZED.test(line)) return true;
  const word = FIRST_WORD.exec(line)?.[0].toLowerCase();
  return word !== undefined && VARIANT_WORDS.has(word);
}

export function readWorkoutText(raw: string): ReadResult {
  const clean = cleanWorkoutText(raw);
  const s: ReadState = { sections: [], items: [], routineNotes: [], section: null, run: null, runs: 0 };
  const placed: { text: string; as: LinePlacement }[] = [];
  let name: string | null = null;
  let nameFromWorkout = false;

  // AC45: when the paste has header badges, only the lines above them head sections.
  const badgeMode = clean.tagged.some(Boolean);

  clean.lines.forEach((line, i) => {
    const heading = badgeMode
      ? clean.tagged[i]
        ? (headingOf(line, false, false) ?? { name: line.endsWith(":") ? line.slice(0, -1).trimEnd() : line, workout: false })
        : null
      : headingOf(line, i === clean.lines.length - 1, s.run !== null);
    const open = s.section === null ? null : s.sections[s.section]!;
    // AC46: the same header again (the next screenshot, overlap not removed) continues its section.
    if (heading && open && ocrKey(heading.name) === ocrKey(open.name)) {
      s.run = null;
      placed.push({ text: line, as: "heading" });
      return;
    }
    if (heading) {
      s.run = null;
      const warmup = WARMUP.test(heading.name);
      s.sections.push({ name: heading.name, notes: [], warmup, strength: null, fresh: true, notesOnly: false });
      s.section = s.sections.length - 1;
      if (heading.workout && !nameFromWorkout) {
        name = heading.name;
        nameFromWorkout = true;
      } else if (name === null && !warmup) name = heading.name;
      placed.push({ text: line, as: "heading" });
      return;
    }
    const current = s.section === null ? null : s.sections[s.section]!;
    // AC47: the card repeats its header as its first line ("Warmup" under Warmup).
    if (current?.fresh && ocrKey(line) === ocrKey(current.name)) {
      current.fresh = false;
      placed.push({ text: line, as: "heading" });
      return;
    }
    if (current) current.fresh = false;
    if (current && !current.warmup && (current.notesOnly || isVariantLabel(line))) {
      current.notesOnly = true;
      s.run = null;
      current.notes.push(line);
      placed.push({ text: line, as: "note" });
      return;
    }
    if (current?.warmup) {
      current.notes.push(line);
      placed.push({ text: line, as: "note" });
      return;
    }
    const as = readConstruct(line, s);
    if (as === "note") (current ? current.notes : s.routineNotes).push(line);
    if (as) {
      placed.push({ text: line, as });
      return;
    }
    s.run = null;
    (current ? current.notes : s.routineNotes).push(line);
    placed.push({ text: line, as: "note" });
  });

  const names: { key: string; written: string; sections: string[] }[] = [];
  for (const item of s.items) {
    let entry = names.find((n) => n.key === item.nameKey);
    if (!entry) names.push((entry = { key: item.nameKey, written: item.name, sections: [] }));
    const sectionName = item.section === null ? null : s.sections[item.section]!.name;
    if (sectionName !== null && !entry.sections.includes(sectionName)) entry.sections.push(sectionName);
  }

  return {
    name,
    notes: s.routineNotes.join("\n"),
    sections: s.sections.map(({ name: n, notes, warmup }) => ({ name: n, notes: notes.join("\n"), warmup })),
    items: s.items.map((it) => ({ ...it })),
    names,
    chunks: clean.chunks,
    lines: { input: clean.input, furniture: clean.furniture, overlap: clean.overlap, placed },
  };
}
