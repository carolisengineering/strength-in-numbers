import { TIMER_ISSUE_CODES, type TimerIssueCode } from "@sin/core";
import { describe, expect, it } from "vitest";
import { TIMER_ISSUE_COPY, timerIssueCopy } from "./timerIssueCopy";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const sources = raw(
  import.meta.glob(["./*.ts", "./*.tsx", "../workouts/result/*.ts", "../workouts/result/*.tsx", "!./*.test.*", "!../workouts/result/*.test.*"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("10.7 AC56 — every timer issue code has a sentence", () => {
  it("the keys are exactly the core's codes", () => {
    expect(Object.keys(TIMER_ISSUE_COPY).sort()).toEqual([...TIMER_ISSUE_CODES].sort());
  });

  it("every sentence is non-empty and ends with a period", () => {
    for (const text of Object.values(TIMER_ISSUE_COPY)) expect(text).toMatch(/^.+\.$/);
  });

  it.each<[TimerIssueCode, string]>([
    ["round_beyond_rounds", "That round is past the planned rounds."],
    ["seconds_over_round", "Longer than the round length."],
    ["seconds_over_cap", "Past the time limit or cap."],
    ["seconds_not_after_previous", "Must be later than the round before."],
    ["seconds_not_before_next", "Must be earlier than the round after."],
    ["rounds_required", "Enter the rounds."],
    ["reps_required", "Enter the reps."],
    ["finish_not_allowed", "A finish time doesn't go with this result."],
    ["capped_not_allowed", "An AMRAP has no cap to hit."],
    ["rounds_reps_not_allowed", "Rounds and reps don't go with a finish time."],
    ["finish_over_cap", "The finish time is past the cap."],
    ["finish_required", "Enter a finish time, or choose Hit the cap."],
    ["capped_needs_cap", "This section has no cap to hit."],
    ["rounds_or_reps_required", "Give rounds or reps."],
    ["nothing_to_record", "Enter a result to save."],
    ["fit_rounds_below_recorded", "Times are logged for later rounds."],
    ["fit_round_shorter_than_recorded", "A logged time is longer than this round length."],
    ["fit_cap_below_reading", "A logged round end is past this limit."],
    ["fit_cap_below_finish", "The logged finish time is past this cap."],
    ["fit_cap_removed_while_capped", "The logged result hit the cap, so the cap stays."],
    ["fit_result_on_set_timer", "A Set Timer doesn't take a rounds-and-reps result."],
  ])("%s", (code, text) => {
    expect(TIMER_ISSUE_COPY[code]).toBe(text);
    expect(timerIssueCopy(code)).toBe(text);
  });

  it("no source reads an issue's message", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const offenders = Object.entries(sources).filter(([, src]) => /issue\.message|\.message\b.*Issue/.test(stripComments(src)));
    expect(offenders.map(([p]) => p)).toEqual([]);
  });
});
