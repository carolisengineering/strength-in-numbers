import { describe, expect, it } from "vitest";
import { CAP_MAX_ERROR, ROUND_LENGTH_MAX_ERROR, ROUNDS_RANGE_ERROR, TIMER_CHECK_ERROR } from "./timerCopy";
import { timerErrorsFromServer } from "./timerServerErrors";

const errs = (...paths: string[]) => paths.map((path) => ({ path, message: "SERVER-SECRET" }));

describe("10.7 AC25 — timer 422 paths map to field copy", () => {
  it.each<[string, Record<string, string>]>([
    ["timer.rounds", { rounds: ROUNDS_RANGE_ERROR }],
    ["timer.roundSeconds", { roundSeconds: ROUND_LENGTH_MAX_ERROR }],
    ["timer.capSeconds", { capSeconds: CAP_MAX_ERROR }],
    ["timer", { group: TIMER_CHECK_ERROR }],
    ["timer.format", { group: TIMER_CHECK_ERROR }],
    ["timer.rounds.extra", { group: TIMER_CHECK_ERROR }],
  ])("%s", (path, expected) => {
    expect(timerErrorsFromServer(errs(path), "timer")).toEqual(expected);
  });

  it("no timer path gives null", () => {
    expect(timerErrorsFromServer(errs("name"), "timer")).toBeNull();
    expect(timerErrorsFromServer(errs("timerish"), "timer")).toBeNull();
    expect(timerErrorsFromServer([], "timer")).toBeNull();
  });

  it("collects several fields, and a longer prefix works the same way", () => {
    expect(timerErrorsFromServer(errs("name", "sections.2.timer.rounds", "sections.2.timer.capSeconds", "sections.1.timer"), "sections.2.timer")).toEqual({
      rounds: ROUNDS_RANGE_ERROR,
      capSeconds: CAP_MAX_ERROR,
    });
  });

  it("never echoes the server's message", () => {
    const out = timerErrorsFromServer(errs("timer.rounds", "timer", "timer.capSeconds"), "timer");
    expect(JSON.stringify(out)).not.toContain("SERVER-SECRET");
  });
});
