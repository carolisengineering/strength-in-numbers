/**
 * Spec 10.4 §6.1 — pure reader for pasted Live Text (a gym app's workout screenshots). Cleaning
 * chunks the paste at status-bar clock lines, drops exact furniture lines and removes the overlap
 * between consecutive screenshots. Every function is total and linear: anchored patterns, no
 * nested quantifiers. No I/O, no DOM, no Node APIs.
 */
import { normalizeExerciseName } from "./exerciseMatch.js";

/** The paste box's limit (Phase B); the reader itself accepts any length. */
export const IMPORT_TEXT_MAX = 40_000;

/**
 * A status-bar time; AC42: optionally one icon after it (a space and ≤ 3 characters with no letter or digit).
 * AC55: the muted bell also reads as one digit stuck on (`3:524`), one letter after a space (`3:52 A`), or an
 * icon in front (`€ 3:53`).
 */
export const CLOCK_LINE = /^(?:[^\p{L}\p{N}\s]{1,3} )?\d{1,2}:\d{2}(?:\d|(?: ?[AP]M)?(?: (?:[^\p{L}\p{N}\s]{1,3}|\p{L}))?)$/iu;
export const RESULTS_LINE = /^RESULTS \(\d{1,6}\)$/i;
export const BADGE_LINES: readonly string[] = ["NO SCORE", "WEIGHT", "TIME", "REPS", "ROUNDS", "DISTANCE", "CALORIES", "LOAD", "Log result"];
export const GYM_LINES: readonly string[] = ["HIRAYA TRAINING HOUSE", "HIRAYA", "TRAINING HOUSE"];
export const NAV_LINES: readonly string[] = ["Home", "Schedule", "Workouts", "Social"];
/** AC56: the cellular network names a status bar shows. */
export const NETWORK_NAMES: readonly string[] = ["LTE", "5G", "5G+", "5GE", "4G", "3G"];

/** AC45: the badges that sit beside a section header ("Log result" is a button, not a badge). */
const HEADER_BADGES = new Set(BADGE_LINES.filter((l) => l !== "Log result").map((l) => l.toLowerCase()));
const FURNITURE = new Set([...BADGE_LINES, ...GYM_LINES, ...NAV_LINES].map((l) => l.toLowerCase()));
// C0 controls, DEL, C1 controls and the zero-width space / word joiner; `\s` covers NBSP and BOM.
// eslint-disable-next-line no-control-regex -- turning control characters into spaces is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b\u2060]/g;
const LINE_BREAK = /\r\n|\r|\n/;
const ALNUM = /[\p{L}\p{N}]/u;
const LATIN_OR_DIGIT = /[A-Za-z0-9\u00C0-\u024F]/;
/** Outside printable ASCII (lines are collapsed first, so no control characters remain). */
const NON_ASCII = /[^ -~]/;
/** The signal-strength bars as Live Text reads them: a dot, then up to three bar-like characters. */
const SIGNAL_BARS = /^[•·][•·.0oOlI|]{0,3}$/;
const DIGIT_CHAR = /\d/;
const DIGIT_START = /^\d/;
/** AC57: the trophy icon as Live Text reads it (`Y'`, `只'`). */
const TROPHY_MAX = 3;
const SCORE_WORDS_MAX = 6;

/** Control characters become spaces, whitespace runs collapse to one space, ends trimmed. */
export function collapseLine(line: string): string {
  return line.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

/** Screen icons read as text are short; a longer line with no Latin letter is someone's text (a note in another script). */
const ICON_MAX_LENGTH = 8;

/** AC43: a status-bar or tab-bar icon read as text, dropped anywhere: a short line with no letter or digit in any script, or the signal bars. */
export function isIconLine(line: string): boolean {
  const l = collapseLine(line);
  // Plain ASCII marks ("***", "---", "|") are the author's separators, not icons.
  return l !== "" && l.length <= ICON_MAX_LENGTH && ((!ALNUM.test(l) && NON_ASCII.test(l)) || SIGNAL_BARS.test(l));
}

/**
 * AC43 (item 71): Live Text also reads icons as short words in another script ("口", "الهه"). Such a line is an
 * icon only beside the screen's chrome (see `nearChrome`); elsewhere it is someone's text ("Жим").
 */
function isScriptIconLine(l: string): boolean {
  return l.length <= ICON_MAX_LENGTH && !LATIN_OR_DIGIT.test(l) && NON_ASCII.test(l);
}

const NETWORK = new Set(NETWORK_NAMES.map((n) => n.toLowerCase()));
/** Before the network name: the signal bars, as bar-like characters (`•ll`, `Il`, `all`, `•ill`). */
const SIGNAL_TOKEN = /^[•·.0oOlIia|]{1,4}$/;
/** After it: a network suffix or the battery (`UW`, `O`, `C`). */
const STATUS_TAIL_MAX = 3;

/** AC56: the cellular status bar as Live Text reads it (`•ll LTE O`, `all LTE L`, `ll 5G UW`): dropped anywhere. */
export function isStatusBarLine(line: string): boolean {
  const tokens = collapseLine(line).split(" ");
  if (tokens.length < 2 || tokens.length > 3) return false;
  const network = tokens.findIndex((t) => NETWORK.has(t.toLowerCase()));
  return network >= 0 && tokens.every((t, i) => i === network || (i < network ? SIGNAL_TOKEN.test(t) : t.length <= STATUS_TAIL_MAX));
}

/** AC45, AC58: a header badge, or badge words joined by `/` (`ROUNDS/REPS`). `Log result` is a button, never a badge. */
export function isBadgeLine(line: string): boolean {
  const parts = collapseLine(line).split("/").map((p) => p.trim().toLowerCase());
  return parts.every((p) => HEADER_BADGES.has(p));
}

export function isFurnitureLine(line: string): boolean {
  const l = collapseLine(line);
  return CLOCK_LINE.test(l) || RESULTS_LINE.test(l) || FURNITURE.has(l.toLowerCase()) || isIconLine(l) || isStatusBarLine(l) || isBadgeLine(l);
}

const NAV = new Set(NAV_LINES.map((l) => l.toLowerCase()));
/** The status bar sits just under the clock line (at most one line of text before its last icon), the tab bar's icons between its labels. */
const STATUS_BAR_TEXT_LINES = 1;

const LOOK_ALIKES: Readonly<Record<string, string>> = { "0": "o", "9": "g", "1": "l", "|": "l", "5": "s" };
/** Letters whose two cases differ only in size, so Live Text can read either, plus the capitals of the look-alikes' letters. */
const SAME_SHAPE_UPPER = /[COSUVWXZGL]/g;
/**
 * AC44: the overlap compares lines through this key, so Live Text's look-alike misreads ("90s" / "g0s" / "gos") still
 * match. Case is kept otherwise (item 72): "1:30 REST" and "1:30 Rest" are different lines.
 */
export function ocrKey(line: string): string {
  return collapseLine(line)
    // AC59: Live Text reads one word two ways ("We're" / "Were", "weeks" / "week's").
    .replace(/['’‘`]/g, "")
    .replace(SAME_SHAPE_UPPER, (c) => c.toLowerCase())
    .replace(/[0915|]/g, (c) => LOOK_ALIKES[c]!);
}

/** Header names compare without case (the same header again, a card repeating its header). */
const headerKey = (line: string) => ocrKey(line).toLowerCase();

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
  const all = raw.split(LINE_BREAK).map(collapseLine).filter((l) => l !== "");
  const nav = all.map((l) => NAV.has(l.toLowerCase()));
  // Lines of text kept since the last clock line; icons and other furniture don't count.
  let textSinceClock = Infinity;
  // Lines of text kept since the last tab-bar line (or the paste's start): a status bar sits at a screenshot's top.
  let textSinceNav = 0;
  for (const [i, line] of all.entries()) {
    input++;
    const nearChrome = textSinceClock <= STATUS_BAR_TEXT_LINES || nav[i - 1] === true || nav[i + 1] === true;
    const after = previous;
    previous = line;
    const chunk = chunks[chunks.length - 1]!;
    // A tab bar is several of its words close together (icons between); one "Home" in the text is an at-home label.
    if (nav[i] && [-2, -1, 1, 2].some((d) => nav[i + d] === true)) textSinceNav = 0;
    if (CLOCK_LINE.test(line)) {
      furniture++;
      // #168: a bare time inside the workout text ("4:00" under a time cap) still splits screenshots (AC42), but only a
      // clock at the top opens the status-bar window, so a short non-Latin name after a mid-text time is kept.
      textSinceClock = textSinceNav === 0 ? 0 : Infinity;
      chunks.push([]);
      continue;
    }
    if (isBadgeLine(line)) {
      // A badge that opens a screenshot belongs to the header that ended the one before.
      const before = chunk.length > 0 ? chunk : [...chunks].reverse().find((c) => c.length > 0);
      const above = before?.[before.length - 1];
      if (above) above.tagged = true;
    }
    // AC57: the trophy just above "RESULTS (n)" and the card's score just below it ("49", "3 + 0", "5 @ 130 Lbs").
    const trophy = line.length <= TROPHY_MAX && !DIGIT_CHAR.test(line) && RESULTS_LINE.test(all[i + 1] ?? "");
    const score = RESULTS_LINE.test(after) && DIGIT_START.test(line) && wordCount(line) <= SCORE_WORDS_MAX;
    if (isFurnitureLine(line) || (nearChrome && isScriptIconLine(line)) || trophy || score) {
      furniture++;
      continue;
    }
    chunk.push({ text: line, tagged: false });
    textSinceClock++;
    textSinceNav++;
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
    // A cut-off last line of A gives way to B's full line, which stays (item 75).
    if (cut.dropA === 1 && a[a.length - 1]!.tagged) b[cut.dropB]!.tagged = true;
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
  /** Spec 05.3 AC34: read from a calorie form ("Max Cal …", "20 Cal …"). */
  readonly calories: boolean;
}
export interface ReadName {
  /** normalizeExerciseName(written), or `written:<name>` when that is empty (#169). */
  readonly key: string;
  readonly written: string;
  /** Names of the sections using it (loose omitted). */
  readonly sections: readonly string[];
  /** True iff any item with this key was read from a calorie form: the hint for guessModality. */
  readonly calories: boolean;
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
  calories: boolean;
}
/** `strict`: an AC48 run ("N Sets, 1 Set Every M:SS"), where a movement needs reps, a distance or a Max form. */
/** `list`: AC62, counted lines with no lead-in; its items are rowless. */
type Run =
  | { id: number; kind: "scheme"; reps: number[]; text: string }
  | { id: number; kind: "lead-in"; n: number; strict?: boolean }
  | { id: number; kind: "list" };

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
const UNIT_WORD = /^(?:m|meters?|km|mi|miles?|ft|min|minutes?|sec|seconds?|s|cals?|calories?)$/i;
/** AC48: "3 Sets, 1 Set Every 4:00" — a set count with more after a comma. */
const LEAD_IN_SETS_EVERY = /^(\d{1,2})\s+sets?\s*,\s*\S.*$/i;
/** AC61: "3-4 Sets" — a set-count range. */
const LEAD_IN_RANGE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(?:sets?|rounds?):?$/i;
/** AC49: interval lines that describe the work, not a movement. */
const WORK_REST = /^(?:\d{1,3}x\s+)?\d{1,3}(?::\d{2})?s?\s+on\s*\/\s*\d{1,3}(?::\d{2})?s?\s+rest$/i;
const REST_LINE = /^rest\b/i;
/**
 * #155: the rest-pause technique names a movement ("Rest-Pause Curls", an en dash too); "Rest pause as needed",
 * "Rest-Pause between sets" or "Rest pause 30s" is still a Rest line. Tested only on short lines (isMovementText's 60).
 */
const REST_PAUSE_MOVEMENT =
  /^rest[\s\-–]*pause\s+(?!.*\b(?:as|between|for|after|until|each|per|on|of|then|and|with|to|needed|secs?|seconds?)\b)\D+$/i;
const isRestLine = (text: string): boolean => REST_LINE.test(text) && !(text.length <= 60 && REST_PAUSE_MOVEMENT.test(text));
/** A counted line that is structure, not a movement, once its comma goes ("5 Rounds of,", "8 Rest,"): #155 review. */
const STRUCTURE_START = /^(?:rounds?|sets?|supersets?|times?|rest|break)\b/i;
const DANGLING_END = /\s(?:of|through|for|then|and|with|to)$/i;
/**
 * Item 69: "Rx", "Rx:", "Rx (95/65 lb)", "Rx'd: 95/65" name the prescribed version, so the movements after it are the
 * workout. A name that only starts with Rx ("Rx Bar Hang": no colon, parenthesis or digit) is a movement.
 */
const RX_LINE = /^\(?rx(?:'?d)?\b(?=.*[:(\d]|\s*\)?$)/i;
/**
 * AC50: "Max Cal Echo Bike with remaining time" — name the movement, keep the rest as its note. Linear only on
 * collapsed lines (single spaces): the lazy name before an optional suffix is quadratic over a long whitespace run.
 */
const MAX_LINE = /^(max(?:\s+(?:cal|calories|reps))?)\s+(\S.*?)(?:\s+(with\s+(?:the\s+)?remaining\s+time))?$/i;
/** AC51: "10 Tuckups + 15 Hollow Rocks". */
const PLUS = /\s\+\s/;
const TRAILING_PLUS = /\s?\+$/;
/** "Max Cal", "with remaining time" → "Max Cal, with remaining time". */
const maxNote = (max: RegExpExecArray) => [max[1]!, max[3]].filter((x): x is string => x !== undefined).join(", ");
/** AC11, AC50; AC62: a split value (`250/200m`) is one measure. */
const LEADING_MEASURE =
  /^(\d{1,6}(?:[.,]\d{1,3})?(?:\/\d{1,6}(?:[.,]\d{1,3})?)?\s?(?:m|meters?|km|mi|miles?|ft|min|minutes?|sec|seconds?|s|cal|calories?))(?:\s|$)/i;
/** AC62: only a distance starts a counted line with no lead-in; a time never does ("20 Minute Cap"). */
const LEADING_DISTANCE = /^(\d{1,6}(?:[.,]\d{1,3})?(?:\/\d{1,6}(?:[.,]\d{1,3})?)?\s?(?:m|meters?|km|mi|miles?|ft))(?:\s|$)/i;
/** AC60: a load after " @ " ("5 Back Squats @ 60-65% of IRM") is the exercise's note, not its name. */
const LOAD_MARK = " @ ";
function splitLoad(text: string): { text: string; load: string | null } {
  const at = text.indexOf(LOAD_MARK);
  return at < 0 ? { text, load: null } : { text: text.slice(0, at).trim(), load: text.slice(at + 1).trim() };
}
/**
 * Spec 05.3 AC36: "20 Cal Row", "15 Cals Ski Erg", "20cal Row" — a calorie goal on a movement. The name is the movement
 * alone and the measure its note; the number is never a target (FI-11). "Calf" never matches: a space must follow.
 */
const LEADING_CAL = /^(\d{1,4}\s?(?:cals?|calories?))\s+(\S.*)$/i;
/** The leading calorie form, when what follows is one movement (never an "A + B" pair, AC37). */
function leadingCalorieOf(text: string): { measure: string; movement: string } | null {
  const m = LEADING_CAL.exec(text);
  if (!m || PLUS.test(m[2]!) || !isMovementText(m[2]!)) return null;
  return { measure: m[1]!, movement: m[2]! };
}
const MAX_CAL = /cal/i;

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
/**
 * #155: a counted movement keeps its place when its line ends in a comma ("10 Push-ups," is Push-ups), under a run or
 * on a bullet. Anything else keeps the comma, so it stays a note (AC49): a cue, or structure such as "5 Rounds of,".
 */
function dropMovementComma(text: string): string {
  if (!text.endsWith(",")) return text;
  const bare = text.slice(0, -1).trimEnd();
  // Spec 05.3: a leading calorie line ("20 Cal Row,") is a counted movement too.
  if (leadingCalorieOf(bare) !== null) return bare;
  const form = repFormOf(bare);
  return form && isMovementText(bare) && !STRUCTURE_START.test(form.name) && !DANGLING_END.test(form.name) ? bare : text;
}

function isMovementText(text: string): boolean {
  return (
    text.length <= 60 && text.split(" ").length <= 6 && LETTER.test(text) && !MOVEMENT_PUNCTUATION.test(text) &&
    leadInCount(text) === null && !SCHEME.test(text)
  );
}

/**
 * #169: a name with no letter or digit ("!!!", a section title used by its set lines) normalizes to "", which would
 * make every such name one Check card. It gets its own key per written form instead; a real key is only letters and
 * digits, so the ":" keeps the two kinds apart.
 */
function nameKeyOf(name: string): string {
  const key = normalizeExerciseName(name);
  return key === "" ? `written:${name}` : key;
}

function pushItem(s: ReadState, item: Omit<MutableItem, "nameKey" | "section">): void {
  s.items.push({ ...item, nameKey: nameKeyOf(item.name), section: s.section });
}

/** One movement under an open run (AC8–AC11): rows from the run, the rep form or leading distance as its note. */
function pushMovement(
  s: ReadState,
  run: Exclude<Run, { kind: "list" }>,
  text: string,
  form: RepForm | null,
  extraNotes: readonly string[] = [],
  calories = false,
): void {
  const noteLines: string[] = [];
  let name = text;
  if (form) {
    name = form.name;
    if (run.kind === "scheme") noteLines.push(form.text);
    else if (form.note) noteLines.push(form.note);
  } else if (!calories) {
    const measure = LEADING_MEASURE.exec(text);
    if (measure) noteLines.push(measure[1]!);
  }
  noteLines.push(...extraNotes);
  const rows =
    run.kind === "scheme"
      ? run.reps.map((r) => ({ repsLow: r, repsHigh: r }))
      : Array.from({ length: run.n }, () => form?.reps ?? { repsLow: null, repsHigh: null });
  pushItem(s, { name, rows, quickReps: null, repsText: run.kind === "scheme" ? run.text : (form?.text ?? null), noteLines, run: run.id, calories });
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
      pushItem(s, { name: section.name, rows: [], quickReps: null, repsText: null, noteLines: [], run: null, calories: false });
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
    s.run = { id: ++s.runs, kind: "lead-in", n: Number(every[1]), strict: true };
    return "note";
  }
  // AC61: "3-4 Sets" opens a run of the low end and stays in the note, so the range is not lost.
  const range = LEAD_IN_RANGE.exec(line);
  if (range && Number(range[1]) >= 1 && Number(range[1]) <= Number(range[2])) {
    s.run = { id: ++s.runs, kind: "lead-in", n: Number(range[1]) };
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
  if (s.run !== null && s.run.kind !== "list") {
    // Item 74: a trailing "+" ("200 Meter Run+") joins the next line in the app; it is never part of a name.
    // AC60: a load after " @ " goes last in the note; the rest of the line is read as before.
    const { text: raw, load } = splitLoad(dropMovementComma(line.replace(BULLET, "").replace(TRAILING_PLUS, "")));
    const loadNote = load === null ? [] : [load];
    // AC49: lines that describe the interval go to the note and keep the run open.
    // A parenthesized cue ("(each leg)") is a note too.
    if (WORK_REST.test(raw) || raw.endsWith(",") || isRestLine(raw) || RX_LINE.test(raw) || PARENTHESIZED.test(raw)) return "note";
    // AC51: "A + B" with a rep form on every side is one exercise per side; a load belongs to the last side.
    const parts = raw.split(PLUS);
    if (parts.length > 1 && parts.every((p) => isMovementText(p) && repFormOf(p) !== null)) {
      const run = s.run;
      parts.forEach((part, i) => pushMovement(s, run, part, repFormOf(part), i === parts.length - 1 ? loadNote : []));
      return "movement";
    }
    // AC50: "Max Cal X with remaining time" → X, with "Max Cal, with remaining time" as its note.
    // "Max" is a rep count, never part of a name: "Max Hang" is Hang (owner, 2026-10-24; replaces item 70's fix).
    const max = MAX_LINE.exec(raw);
    if (max && isMovementText(max[2]!)) {
      pushMovement(s, s.run, max[2]!, null, [maxNote(max), ...loadNote], MAX_CAL.test(max[1]!));
      return "movement";
    }
    // Spec 05.3 AC36: "20 Cal Row" → Row, with "20 Cal" as its note and the calories hint.
    const cal = leadingCalorieOf(raw);
    if (cal) {
      pushMovement(s, s.run, cal.movement, null, [cal.measure, ...loadNote], true);
      return "movement";
    }
    // AC48: coaching text after "N Sets, 1 Set Every M:SS" ("Build to a heavy 5") is a note, not an exercise.
    if (s.run.kind === "lead-in" && s.run.strict && repFormOf(raw) === null && !LEADING_MEASURE.test(raw)) return "note";
    if (!isMovementText(raw)) return null;
    pushMovement(s, s.run, raw, repFormOf(raw), loadNote);
    return "movement";
  }

  // 8. A bare bullet with a rep form, or a Max form, is a rowless item (AC10, AC50). It closes an AC62 list.
  if (BULLET.test(line)) {
    s.run = null;
    const { text, load } = splitLoad(dropMovementComma(line.replace(BULLET, "").replace(TRAILING_PLUS, "")));
    const loadNote = load === null ? [] : [load];
    const max = MAX_LINE.exec(text);
    if (max && isMovementText(max[2]!)) {
      pushItem(s, { name: max[2]!, rows: null, quickReps: null, repsText: null, noteLines: [maxNote(max), ...loadNote], run: null, calories: MAX_CAL.test(max[1]!) });
      return "movement";
    }
    const cal = leadingCalorieOf(text);
    if (cal) {
      pushItem(s, { name: cal.movement, rows: null, quickReps: null, repsText: null, noteLines: [cal.measure, ...loadNote], run: null, calories: true });
      return "movement";
    }
    const form = repFormOf(text);
    if (!form) return null;
    pushItem(s, { name: form.name, rows: null, quickReps: form.reps, repsText: form.text, noteLines: [...(form.note ? [form.note] : []), ...loadNote], run: null, calories: false });
    return "movement";
  }

  // 9. AC62 (owner ruling 2026-10-26): inside a section, a counted line with no lead-in is a rowless exercise.
  return section && countedLineOf(line, s) ? "movement" : null;
}

/** A counted name that is structure, not a movement ("Rounds for time", "Reps of"). */
const isStructureName = (name: string) => STRUCTURE_START.test(name) || DANGLING_END.test(name);

/**
 * AC62: an un-bulleted line starting with reps, calories or a distance is a rowless exercise; consecutive ones are one
 * list (a superset). Reached only inside a non-Warmup section, outside a run, before a variant label.
 */
function countedLineOf(line: string, s: ReadState): boolean {
  const { text, load } = splitLoad(line.replace(TRAILING_PLUS, ""));
  if (text.endsWith(",") || WORK_REST.test(text) || isRestLine(text) || RX_LINE.test(text) || PARENTHESIZED.test(text) || !isMovementText(text)) return false;
  let item: Omit<MutableItem, "nameKey" | "section" | "run"> | null = null;
  const cal = leadingCalorieOf(text);
  const form = cal ? null : repFormOf(text);
  const distance = cal || form ? null : LEADING_DISTANCE.exec(text);
  if (cal) {
    item = { name: cal.movement, rows: null, quickReps: null, repsText: null, noteLines: [cal.measure], calories: true };
  } else if (form && !isStructureName(form.name)) {
    item = { name: form.name, rows: null, quickReps: form.reps, repsText: form.text, noteLines: form.note ? [form.note] : [], calories: false };
  } else if (distance) {
    const rest = text.slice(distance[0].length).trim();
    if (LETTER.test(rest) && !isStructureName(rest)) item = { name: text, rows: null, quickReps: null, repsText: null, noteLines: [distance[1]!], calories: false };
  }
  if (item === null) return false;
  if (s.run?.kind !== "list") s.run = { id: ++s.runs, kind: "list" };
  pushItem(s, { ...item, noteLines: load === null ? item.noteLines : [...item.noteLines, load], run: s.run.id });
  return true;
}

/** AC52: the first words that name an alternative version of the workout (lowercase). */
const VARIANT_WORDS = new Set([
  "scaled", "scale", "outdoor", "outdoors", "indoor", "modified", "beginner", "intermediate", "advanced",
  "alternative", "alternatives", "option", "options", "sub", "subs", "substitute", "intent", "travel", "home",
]);
const NON_LABEL = /^non[- ]/i;
const AT_HOME = /^at home\b/i;
const PARENTHESIZED = /^\(.*\)$/;
const FIRST_WORD = /^[\p{L}]+/u;

/** AC52: a line that starts an alternative (scaled, at home, "(No Bike)"); format lines like "For Time:" are not. */
function isVariantLabel(line: string): boolean {
  if (NON_LABEL.test(line) || AT_HOME.test(line)) return true;
  // "(No Bike)", "(Without a rower)", "(Scaled)" — but not a cue like "(each leg)".
  if (PARENTHESIZED.test(line)) {
    const inner = FIRST_WORD.exec(line.slice(1))?.[0].toLowerCase();
    return inner !== undefined && (inner === "no" || inner === "non" || inner === "without" || VARIANT_WORDS.has(inner));
  }
  // A variant word heads a label only when the line reads as one: "Scaled Run:", "Options", "INTENT" — not "Advanced Plank".
  const word = FIRST_WORD.exec(line)?.[0].toLowerCase();
  return word !== undefined && VARIANT_WORDS.has(word) && (line.endsWith(":") || !line.includes(" "));
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
        : isStrictHeading(line)
          ? headingOf(line, false, false)
          : null
      : headingOf(line, i === clean.lines.length - 1, s.run !== null);
    const open = s.section === null ? null : s.sections[s.section]!;
    // AC46: the same header again (the next screenshot, overlap not removed) continues its section.
    if (heading && open && headerKey(heading.name) === headerKey(open.name)) {
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
    if (current?.fresh && headerKey(line) === headerKey(current.name)) {
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

  const names: { key: string; written: string; sections: string[]; calories: boolean }[] = [];
  for (const item of s.items) {
    let entry = names.find((n) => n.key === item.nameKey);
    if (!entry) names.push((entry = { key: item.nameKey, written: item.name, sections: [], calories: false }));
    if (item.calories) entry.calories = true;
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
