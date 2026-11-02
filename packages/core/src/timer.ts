/**
 * Spec 09.5 — the one implementation of a timed section's clock and score text and of its rules
 * (AC3). Pure: no I/O. The server validates with these and the screens (Spec 10.7) do too, so
 * the two cannot disagree. Screens key their wording on `TimerIssue.code`, never on `message`.
 */
import {
  TIMER_ISSUE_MESSAGES,
  type RoundTime,
  type SectionResult,
  type SectionTimer,
  type SetSectionResult,
  type TimerIssue,
  type TimerIssueCode,
} from "./dto/section-timer.js";

const issue = (path: string, code: TimerIssueCode): TimerIssue => ({ path, code, message: TIMER_ISSUE_MESSAGES[code] });

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Whole seconds as `m:ss`, or `h:mm:ss` from one hour: `0:05`, `3:41`, `1:02:05`. */
export function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`;
}

/** `Set Timer 5 × 5:00`, `AMRAP 12:00`, `Time Cap 15:00`, or `For Time` for a time cap with no cap. */
export function describeTimer(timer: SectionTimer): string {
  switch (timer.format) {
    case "set_timer":
      return `Set Timer ${timer.rounds} × ${formatClock(timer.roundSeconds)}`;
    case "amrap":
      return `AMRAP ${formatClock(timer.capSeconds)}`;
    case "time_cap":
      return timer.capSeconds === null ? "For Time" : `Time Cap ${formatClock(timer.capSeconds)}`;
  }
}

/** §6.5 — a timed section's score, derived from the stored numbers and never stored itself (D15). */
export type SectionScore =
  | { kind: "total_time"; seconds: number; rounds: number }
  | { kind: "rounds_reps"; rounds: number; reps: number }
  | { kind: "finish_time"; seconds: number }
  | { kind: "capped"; rounds: number | null; reps: number | null };

/** The fields of a `WorkoutSection` the score reads. */
export type ScoredSection = {
  timer: SectionTimer | null;
  result: SectionResult | null;
  roundTimes: readonly RoundTime[];
};

/** `null` for an untimed section and for a timed one with nothing recorded that makes a score. */
export function sectionScore(s: ScoredSection): SectionScore | null {
  const { timer, result } = s;
  if (timer === null) return null;
  switch (timer.format) {
    case "set_timer":
      if (s.roundTimes.length === 0) return null;
      return { kind: "total_time", seconds: s.roundTimes.reduce((sum, r) => sum + r.seconds, 0), rounds: s.roundTimes.length };
    case "amrap":
      if (result === null || result.rounds === null || result.reps === null) return null;
      return { kind: "rounds_reps", rounds: result.rounds, reps: result.reps };
    case "time_cap":
      if (result === null) return null;
      if (result.capped) return { kind: "capped", rounds: result.rounds, reps: result.reps };
      return result.finishSeconds === null ? null : { kind: "finish_time", seconds: result.finishSeconds };
  }
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `total 17:42` · `5 rounds + 7 reps` · `finish 14:20` · `Capped · 4 rounds + 7 reps`. */
export function scoreText(score: SectionScore): string {
  switch (score.kind) {
    case "total_time":
      return `total ${formatClock(score.seconds)}`;
    case "rounds_reps":
      return `${counted(score.rounds, "round", "rounds")} + ${counted(score.reps, "rep", "reps")}`;
    case "finish_time":
      return `finish ${formatClock(score.seconds)}`;
    case "capped": {
      const parts: string[] = [];
      if (score.rounds !== null) parts.push(counted(score.rounds, "round", "rounds"));
      if (score.reps !== null) parts.push(counted(score.reps, "rep", "reps"));
      return `Capped · ${parts.join(" + ")}`;
    }
  }
}

/**
 * §6.3 — the rules for setting `round`'s time to `seconds`. Neighbors are the nearest lower and
 * higher rounds in `existing`, excluding `round` itself, so re-saving a round passes and rounds
 * may arrive in any order. Every issue is returned.
 */
export function roundTimeIssues(timer: SectionTimer, existing: readonly RoundTime[], round: number, seconds: number): TimerIssue[] {
  const issues: TimerIssue[] = [];
  if (timer.format === "set_timer") {
    if (round > timer.rounds) issues.push(issue("round", "round_beyond_rounds"));
    if (seconds > timer.roundSeconds) issues.push(issue("seconds", "seconds_over_round"));
    return issues;
  }
  if (timer.capSeconds !== null && seconds > timer.capSeconds) issues.push(issue("seconds", "seconds_over_cap"));
  let lower: RoundTime | undefined;
  let higher: RoundTime | undefined;
  for (const r of existing) {
    if (r.round < round && (lower === undefined || r.round > lower.round)) lower = r;
    if (r.round > round && (higher === undefined || r.round < higher.round)) higher = r;
  }
  if (lower !== undefined && seconds <= lower.seconds) issues.push(issue("seconds", "seconds_not_after_previous"));
  if (higher !== undefined && seconds >= higher.seconds) issues.push(issue("seconds", "seconds_not_before_next"));
  return issues;
}

/**
 * §6.4 — the rules for a result body on an AMRAP or a Time Cap (a Set Timer is `409` before this).
 * An all-empty body is only `nothing_to_record`: clearing is `DELETE`.
 */
export function resultIssues(timer: Extract<SectionTimer, { format: "amrap" | "time_cap" }>, body: SetSectionResult): TimerIssue[] {
  const rounds = body.rounds ?? null;
  const reps = body.reps ?? null;
  const finish = body.finishSeconds ?? null;
  const capped = body.capped === true;
  if (rounds === null && reps === null && finish === null && !capped) return [issue("rounds", "nothing_to_record")];

  const issues: TimerIssue[] = [];
  if (timer.format === "amrap") {
    if (rounds === null) issues.push(issue("rounds", "rounds_required"));
    if (reps === null) issues.push(issue("reps", "reps_required"));
    if (finish !== null) issues.push(issue("finishSeconds", "finish_not_allowed"));
    if (capped) issues.push(issue("capped", "capped_not_allowed"));
    return issues;
  }

  if (capped) {
    if (timer.capSeconds === null) issues.push(issue("capped", "capped_needs_cap"));
    if (finish !== null) issues.push(issue("finishSeconds", "finish_not_allowed"));
    if (rounds === null && reps === null) issues.push(issue("rounds", "rounds_or_reps_required"));
    return issues;
  }
  if (finish === null) return [issue("finishSeconds", "finish_required")];
  if (rounds !== null) issues.push(issue("rounds", "rounds_reps_not_allowed"));
  if (reps !== null) issues.push(issue("reps", "rounds_reps_not_allowed"));
  if (timer.capSeconds !== null && finish > timer.capSeconds) issues.push(issue("finishSeconds", "finish_over_cap"));
  return issues;
}

/**
 * §6.6 — whether a same-format timer still contains what is recorded. Empty = it fits (the data
 * is kept); otherwise the change needs `discardResult`. A different format never fits; the route
 * decides that before calling this.
 */
export function timerFitsRecorded(timer: SectionTimer, roundTimes: readonly RoundTime[], result: SectionResult | null): TimerIssue[] {
  const issues: TimerIssue[] = [];
  if (timer.format === "set_timer") {
    if (result !== null) issues.push(issue("timer", "fit_result_on_set_timer"));
    if (roundTimes.some((r) => r.round > timer.rounds)) issues.push(issue("timer", "fit_rounds_below_recorded"));
    if (roundTimes.some((r) => r.seconds > timer.roundSeconds)) issues.push(issue("timer", "fit_round_shorter_than_recorded"));
    return issues;
  }
  const cap = timer.capSeconds;
  if (cap !== null && roundTimes.some((r) => r.seconds > cap)) issues.push(issue("timer", "fit_cap_below_reading"));
  if (timer.format === "time_cap" && result !== null) {
    if (cap !== null && result.finishSeconds !== null && result.finishSeconds > cap) issues.push(issue("timer", "fit_cap_below_finish"));
    if (cap === null && result.capped) issues.push(issue("timer", "fit_cap_removed_while_capped"));
  }
  return issues;
}
