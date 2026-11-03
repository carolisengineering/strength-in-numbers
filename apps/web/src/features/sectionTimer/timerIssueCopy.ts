import type { TimerIssueCode } from "@sin/core";

/**
 * Spec 10.7 AC56 — one sentence per `@sin/core` timer issue code (approved by Carol, 2026-11-03). Screens pick the
 * sentence by `code`, never by the issue's `message`. A code the app's own screens can't produce still gets one.
 */
export const TIMER_ISSUE_COPY: Readonly<Record<TimerIssueCode, string>> = Object.freeze({
  round_beyond_rounds: "That round is past the planned rounds.",
  seconds_over_round: "Longer than the round length.",
  seconds_over_cap: "Past the time limit or cap.",
  seconds_not_after_previous: "Must be later than the round before.",
  seconds_not_before_next: "Must be earlier than the round after.",
  rounds_required: "Enter the rounds.",
  reps_required: "Enter the reps.",
  finish_not_allowed: "A finish time doesn't go with this result.",
  capped_not_allowed: "An AMRAP has no cap to hit.",
  rounds_reps_not_allowed: "Rounds and reps don't go with a finish time.",
  finish_over_cap: "The finish time is past the cap.",
  finish_required: "Enter a finish time, or choose Hit the cap.",
  capped_needs_cap: "This section has no cap to hit.",
  rounds_or_reps_required: "Give rounds or reps.",
  nothing_to_record: "Enter a result to save.",
  fit_rounds_below_recorded: "Times are logged for later rounds.",
  fit_round_shorter_than_recorded: "A logged time is longer than this round length.",
  fit_cap_below_reading: "A logged round end is past this limit.",
  fit_cap_below_finish: "The logged finish time is past this cap.",
  fit_cap_removed_while_capped: "The logged result hit the cap, so the cap stays.",
  fit_result_on_set_timer: "A Set Timer doesn't take a rounds-and-reps result.",
});

export const timerIssueCopy = (code: TimerIssueCode): string => TIMER_ISSUE_COPY[code];
