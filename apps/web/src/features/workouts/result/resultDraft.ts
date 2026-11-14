import {
  RESULT_REPS_MAX,
  RESULT_ROUNDS_MAX,
  TIMER_CAP_SECONDS_MAX,
  TIMER_ROUNDS_MAX,
  resultIssues,
  roundTimeIssues,
  sectionScore,
  type RoundTime,
  type SectionResult,
  type SectionTimer,
  type SetSectionResult,
  type TimerFormat,
  type WorkoutSection,
} from "@sin/core";
import { digitsToSeconds, secondsToDigits } from "../../sectionTimer/clockDigits";
import { CAP_MAX_ERROR, SECONDS_MAX_ERROR } from "../../sectionTimer/timerCopy";
import { timerIssueCopy } from "../../sectionTimer/timerIssueCopy";
import { orderRoundWrites } from "./orderRoundWrites";
import { RESULT_COPY } from "./resultCopy";

/**
 * Spec 10.7 §6.5 — the Log result sheet's draft: digits as typed for each round row (Set Timer: one per planned
 * round; AMRAP / Time Cap: one per recorded reading, plus any the lifter adds), the result's fields as text, and
 * the Time Cap's mode. Seeded from the projected section once per opening; never stored.
 */
export interface ResultDraft {
  format: TimerFormat;
  rows: { round: number; digits: string }[];
  rounds: string;
  reps: string;
  mode: "finished" | "capped";
  finishDigits: string;
}

/** Field errors, keyed `row:<round>`, `rounds`, `reps` and `finish`. */
export type DraftErrors = Record<string, string>;

export type ResultWrite = { kind: "round"; round: number; seconds: number | null } | { kind: "result"; body: SetSectionResult | null };

export type TimedSection = WorkoutSection & { timer: SectionTimer };

const count = (n: number | null) => (n === null ? "" : String(n));

export function draftFromSection(section: TimedSection): ResultDraft {
  const { timer, roundTimes, result } = section;
  const byRound = new Map(roundTimes.map((t) => [t.round, t.seconds]));
  const rows =
    timer.format === "set_timer"
      ? Array.from({ length: timer.rounds }, (_, i) => ({ round: i + 1, digits: secondsToDigits(byRound.get(i + 1) ?? 0) }))
      : [...roundTimes].sort((a, b) => a.round - b.round).map((t) => ({ round: t.round, digits: secondsToDigits(t.seconds) }));
  return {
    format: timer.format,
    rows,
    rounds: count(result?.rounds ?? null),
    reps: count(result?.reps ?? null),
    mode: result?.capped ? "capped" : "finished",
    finishDigits: secondsToDigits(result?.finishSeconds ?? 0),
  };
}

/** Spec 10.7 AC30: switching Finished / Hit the cap empties the other mode's fields. */
export function withMode(draft: ResultDraft, mode: ResultDraft["mode"]): ResultDraft {
  if (mode === draft.mode) return draft;
  return mode === "capped" ? { ...draft, mode, finishDigits: "" } : { ...draft, mode, rounds: "", reps: "" };
}

/** Spec 10.7 AC29: the next round number (the highest shown + 1, or 1); nothing past `TIMER_ROUNDS_MAX`. */
export function addRoundRow(draft: ResultDraft): ResultDraft {
  const highest = draft.rows.reduce((m, r) => Math.max(m, r.round), 0);
  if (highest >= TIMER_ROUNDS_MAX) return draft;
  return { ...draft, rows: [...draft.rows, { round: highest + 1, digits: "" }] };
}

/** Spec 10.7 AC33: Clear result empties the result fields (the round rows stay). */
export function clearResultFields(draft: ResultDraft): ResultDraft {
  return { ...draft, rounds: "", reps: "", finishDigits: "", mode: "finished" };
}

/** The `Next` row: the first empty one. */
export function firstEmptyRow(draft: ResultDraft): number | null {
  return draft.rows.find((r) => r.digits === "")?.round ?? null;
}

/**
 * A clock field's error: seconds of 60 or more, or a time past `TIMER_CAP_SECONDS_MAX`. A For Time section has no
 * cap for `@sin/core` to check against, and the outbox file's schema refuses a body past that bound, so the bound is
 * checked here or a queued op could make the whole file unreadable.
 */
function clockError(digits: string): string | null {
  if (digits === "") return null;
  const s = digitsToSeconds(digits);
  if (s === null) return SECONDS_MAX_ERROR;
  return s > TIMER_CAP_SECONDS_MAX ? CAP_MAX_ERROR : null;
}

/** A clock field's seconds: `null` for empty or 0:00 (nothing recorded), `undefined` when `clockError` has one. */
function clockValue(digits: string): number | null | undefined {
  if (digits === "") return null;
  if (clockError(digits) !== null) return undefined;
  const s = digitsToSeconds(digits)!;
  return s === 0 ? null : s;
}

/** The rows with a valid time, as round times. */
function filledRows(draft: ResultDraft): RoundTime[] {
  return draft.rows.flatMap((r) => {
    const s = clockValue(r.digits);
    return typeof s === "number" ? [{ round: r.round, seconds: s }] : [];
  });
}

/** A whole number as typed (minor 330: never clamped; `validateDraft` flags one over its max). */
const whole = (text: string): number | null => {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** Spec 10.7 AC29–AC30: the result body the draft asks for; `null` when every result field is empty (a Set Timer always). */
export function resultBody(draft: ResultDraft): SetSectionResult | null {
  if (draft.format === "set_timer") return null;
  const rounds = whole(draft.rounds);
  const reps = whole(draft.reps);
  if (draft.format === "amrap") return rounds === null && reps === null ? null : { rounds, reps };
  if (draft.mode === "finished") {
    const finish = clockValue(draft.finishDigits);
    return typeof finish === "number" ? { finishSeconds: finish } : null;
  }
  return { capped: true, ...(rounds === null ? {} : { rounds }), ...(reps === null ? {} : { reps }) };
}

const RESULT_PATH_KEY: Readonly<Record<string, string>> = { rounds: "rounds", reps: "reps", finishSeconds: "finish", capped: "rounds" };

/**
 * Spec 10.7 AC31 — every field's error, through `@sin/core`'s rules and `timerIssueCopy` (never an issue's message).
 * Each filled row is checked against the other filled rows of the **final draft**, so shifting every reading in one
 * Save is valid; `orderRoundWrites` then makes each write valid in turn.
 */
export function validateDraft(timer: SectionTimer, draft: ResultDraft): DraftErrors {
  const errors: DraftErrors = {};
  const filled = filledRows(draft);
  for (const row of draft.rows) {
    const s = clockValue(row.digits);
    if (s === undefined) {
      errors[`row:${row.round}`] = clockError(row.digits)!;
      continue;
    }
    if (s === null) continue;
    const issues = roundTimeIssues(timer, filled.filter((t) => t.round !== row.round), row.round, s);
    if (issues[0]) errors[`row:${row.round}`] = timerIssueCopy(issues[0].code);
  }
  if (timer.format === "set_timer") return errors;
  if (draft.mode === "finished" && clockValue(draft.finishDigits) === undefined) {
    errors["finish"] = clockError(draft.finishDigits)!;
    return errors;
  }
  const body = resultBody(draft);
  if (body === null) return errors;
  if ((body.rounds ?? 0) > RESULT_ROUNDS_MAX) errors["rounds"] = RESULT_COPY.roundsMax;
  if ((body.reps ?? 0) > RESULT_REPS_MAX) errors["reps"] = RESULT_COPY.repsMax;
  for (const issue of resultIssues(timer, body)) {
    const key = RESULT_PATH_KEY[issue.path] ?? "rounds";
    errors[key] ??= timerIssueCopy(issue.code);
  }
  return errors;
}

const asResult = (body: SetSectionResult): SectionResult => ({
  rounds: body.rounds ?? null,
  reps: body.reps ?? null,
  finishSeconds: body.finishSeconds ?? null,
  capped: body.capped ?? false,
});
const sameResult = (a: SectionResult | null, b: SectionResult | null) =>
  a === null || b === null ? a === b : a.rounds === b.rounds && a.reps === b.reps && a.finishSeconds === b.finishSeconds && a.capped === b.capped;

/**
 * Spec 10.7 AC31–AC33 — what Save sends: the round writes in `orderRoundWrites` order, then at most one result write
 * (a clear when the draft's result is empty and one is recorded; the body when it differs by value). A Set Timer
 * never sends a result (its score is derived).
 */
export function diffDraft(section: TimedSection, draft: ResultDraft): ResultWrite[] {
  const writes: ResultWrite[] = orderRoundWrites(section.timer.format, section.roundTimes, filledRows(draft)).map((w) => ({ kind: "round", ...w }));
  if (section.timer.format === "set_timer") return writes;
  const body = resultBody(draft);
  if (body === null) {
    if (section.result !== null) writes.push({ kind: "result", body: null });
  } else if (!sameResult(asResult(body), section.result)) {
    writes.push({ kind: "result", body });
  }
  return writes;
}

/** Spec 10.7 AC28: a Set Timer's live total in seconds (`null` when no round has a time, or for another format). */
export function liveTotal(timer: SectionTimer, draft: ResultDraft): number | null {
  if (timer.format !== "set_timer") return null;
  const score = sectionScore({ timer, result: null, roundTimes: filledRows(draft) });
  return score?.kind === "total_time" ? score.seconds : null;
}
