/**
 * Spec 10.4 AC14–AC16 — pure exercise-name keys, the exact / similar catalog match and the
 * modality guess for a name read from pasted text. No I/O, no DOM, no Node APIs.
 */
import type { Modality } from "./enums.js";

/** AC15: tuned only against the built-in catalog table in the tests. */
export const SIMILAR_THRESHOLD = 0.3;
export const HEAD_NOUN_BONUS = 0.25;

const NON_ALNUM = /[^\p{L}\p{N}]+/u;
const MARKS = /\p{M}/gu;
const LEADING_BULLET = /^\s*[-•*]+/;
const ES_PLURAL = /(?:ch|sh|x|z|ss)es$/;
const ALL_DIGITS = /^\d+$/;
const GLUED_DISTANCE = /^\d+(?:m|km|mi|ft)$/;
// Spec 05.3 D20: "ft" only — "feet" / "foot" are words in real exercise names ("Rear Foot Elevated Split Squat").
const UNIT_WORDS = new Set(["m", "meter", "km", "mi", "mile", "ft", "min", "minute", "sec", "second", "s", "cal", "calorie"]);
const DISTANCE_UNITS = new Set(["m", "meter", "km", "mi", "mile", "ft"]);
const DISTANCE_WORDS = new Set(["run", "jog", "sprint", "bike", "erg", "swim"]);
const BODYWEIGHT_KEYS = ["pushup", "pullup", "chinup", "situp", "burpee", "handrelease"];
const EXPANSIONS: Readonly<Record<string, string>> = { db: "dumbbell", kb: "kettlebell", bb: "barbell" };

/**
 * Folded, lowercased words with simple plurals stripped. A trailing `s` counts as a plural when at
 * least three characters of the name precede it (so "Pull-Ups" ≡ "pull up", but "Abs" stays).
 */
function words(name: string): string[] {
  const folded = name.normalize("NFD").replace(MARKS, "").toLowerCase().replace(LEADING_BULLET, "");
  const out: string[] = [];
  let before = 0;
  for (const raw of folded.split(NON_ALNUM)) {
    if (raw === "") continue;
    let w = raw;
    if (ES_PLURAL.test(w)) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss") && before + w.length - 1 >= 3) w = w.slice(0, -1);
    if (w === "") continue; // a possessive "'s" leaves nothing
    out.push(w);
    before += w.length;
  }
  return out;
}

/** "" only when the name has no letter or digit. */
export function normalizeExerciseName(name: string): string {
  return words(name).join("");
}

export interface MatchableRow {
  readonly id: string;
  readonly name: string;
  readonly ownerUserId: string | null;
}

export type ExerciseMatch<R extends MatchableRow> =
  | { readonly kind: "exact"; readonly row: R }
  | { readonly kind: "similar"; readonly row: R }
  | { readonly kind: "none" };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Exact ties: the custom row first, then the lowest name (lowercased, then raw). */
function exactOrder<R extends MatchableRow>(a: R, b: R): number {
  const custom = Number(b.ownerUserId !== null) - Number(a.ownerUserId !== null);
  return custom || byCodeUnit(a.name.toLowerCase(), b.name.toLowerCase()) || byCodeUnit(a.name, b.name);
}

function tokens(name: string): string[] {
  return words(name)
    .map((w) => EXPANSIONS[w] ?? w)
    .filter((w) => !ALL_DIGITS.test(w) && !UNIT_WORDS.has(w));
}

function score(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  const jaccard = shared / (sa.size + sb.size - shared);
  return jaccard + (a[a.length - 1] === b[b.length - 1] ? HEAD_NOUN_BONUS : 0);
}

export function matchExerciseName<R extends MatchableRow>(written: string, rows: readonly R[]): ExerciseMatch<R> {
  const key = normalizeExerciseName(written);
  const expanded = words(written).map((w) => EXPANSIONS[w] ?? w).join("");
  const exact = (k: string, keyOf: (r: R) => string) => (k === "" ? [] : rows.filter((r) => keyOf(r) === k).sort(exactOrder));
  const hit = exact(key, (r) => normalizeExerciseName(r.name))[0] ?? exact(expanded, (r) => words(r.name).map((w) => EXPANSIONS[w] ?? w).join(""))[0];
  if (hit) return { kind: "exact", row: hit };

  const mine = tokens(written);
  let best: { row: R; score: number } | null = null;
  for (const row of rows) {
    const s = score(mine, tokens(row.name));
    if (s < SIMILAR_THRESHOLD) continue;
    if (
      best === null ||
      s > best.score ||
      (s === best.score &&
        (row.name.length < best.row.name.length ||
          (row.name.length === best.row.name.length && byCodeUnit(row.name.toLowerCase(), best.row.name.toLowerCase()) < 0)))
    )
      best = { row, score: s };
  }
  return best ? { kind: "similar", row: best.row } : { kind: "none" };
}

/**
 * AC16. `hang` / `hold` count only as the last word, so "Hang Power Clean" keeps its reps (owner, 2026-10-19).
 * Spec 05.3 AC34: a name the reader saw in a calorie form (`hint.calories`) is Calories, before the distance words.
 */
export function guessModality(name: string, hint?: { calories?: boolean }): Modality {
  if (hint?.calories === true) return "calories";
  const w = words(name);
  const leadingDistance = (ALL_DIGITS.test(w[0] ?? "") && DISTANCE_UNITS.has(w[1] ?? "")) || GLUED_DISTANCE.test(w[0] ?? "");
  if (leadingDistance || w.some((x) => DISTANCE_WORDS.has(x))) return "distance_duration";
  const last = w[w.length - 1];
  if (w.includes("plank") || w.some((x, i) => x === "wall" && w[i + 1] === "sit") || last === "hang" || last === "hold") return "duration";
  const key = w.join("");
  if (BODYWEIGHT_KEYS.some((k) => key.includes(k))) return "bodyweight_reps";
  return "weight_reps";
}
