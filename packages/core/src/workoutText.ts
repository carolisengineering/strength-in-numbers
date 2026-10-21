/**
 * Spec 10.4 §6.1 — pure reader for pasted Live Text (a gym app's workout screenshots). Cleaning
 * chunks the paste at status-bar clock lines, drops exact furniture lines and removes the overlap
 * between consecutive screenshots. Every function is total and linear: anchored patterns, no
 * nested quantifiers. No I/O, no DOM, no Node APIs.
 */

/** The paste box's limit (Phase B); the reader itself accepts any length. */
export const IMPORT_TEXT_MAX = 40_000;

export const CLOCK_LINE = /^\d{1,2}:\d{2}(?: ?[AP]M)?$/i;
export const RESULTS_LINE = /^RESULTS \(\d{1,6}\)$/i;
export const BADGE_LINES: readonly string[] = ["NO SCORE", "WEIGHT", "TIME", "REPS", "ROUNDS", "DISTANCE", "CALORIES", "LOAD", "Log result"];
export const GYM_LINES: readonly string[] = ["HIRAYA TRAINING HOUSE", "HIRAYA", "TRAINING HOUSE"];
export const NAV_LINES: readonly string[] = ["Home", "Schedule", "Workouts", "Social"];

const FURNITURE = new Set([...BADGE_LINES, ...GYM_LINES, ...NAV_LINES].map((l) => l.toLowerCase()));
// C0 controls, DEL, C1 controls and the zero-width space / word joiner; `\s` covers NBSP and BOM.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f​⁠]/g;
const LINE_BREAK = /\r\n|\r|\n/;
const ALNUM = /[\p{L}\p{N}]/u;

/** Control characters become spaces, whitespace runs collapse to one space, ends trimmed. */
export function collapseLine(line: string): string {
  return line.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

export function isFurnitureLine(line: string): boolean {
  const l = collapseLine(line);
  return CLOCK_LINE.test(l) || RESULTS_LINE.test(l) || FURNITURE.has(l.toLowerCase());
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
    let middle = true;
    for (let j = 1; j < k - 1 && middle; j++) middle = a[off + j] === b[j];
    if (!middle) continue;
    const firstA = a[off]!;
    const firstB = b[0]!;
    const lastA = a[a.length - 1]!;
    const lastB = b[k - 1]!;
    if (k === 1) {
      if (firstA === firstB || isSuffixFragment(firstA, firstB)) return { dropA: 0, dropB: 1 };
      if (isPrefixFragment(firstB, firstA)) return { dropA: 1, dropB: 0 };
      continue;
    }
    const firstOk = firstA === firstB || isSuffixFragment(firstA, firstB);
    if (!firstOk) continue;
    if (lastA === lastB) return { dropA: 0, dropB: k };
    if (isPrefixFragment(lastB, lastA)) return { dropA: 1, dropB: k - 1 };
  }
  return null;
}

export function cleanWorkoutText(raw: string): CleanResult {
  let input = 0;
  let furniture = 0;
  const chunks: string[][] = [[]];
  for (const rawLine of raw.split(LINE_BREAK)) {
    const line = collapseLine(rawLine);
    if (line === "") continue;
    input++;
    if (CLOCK_LINE.test(line)) {
      furniture++;
      chunks.push([]);
      continue;
    }
    if (isFurnitureLine(line)) {
      furniture++;
      continue;
    }
    chunks[chunks.length - 1]!.push(line);
  }
  const kept = chunks.filter((c) => c.length > 0);
  let overlap = 0;
  for (let i = 1; i < kept.length; i++) {
    let p = i - 1;
    while (p > 0 && kept[p]!.length === 0) p--;
    const a = kept[p]!;
    const b = kept[i]!;
    if (a.length === 0) continue;
    const cut = overlapAt(a, b);
    if (cut === null) continue;
    a.splice(a.length - cut.dropA, cut.dropA);
    b.splice(0, cut.dropB);
    overlap += cut.dropA + cut.dropB;
  }
  return { lines: kept.flat(), chunks: kept.length, input, furniture, overlap };
}
