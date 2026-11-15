import { SectionTimerSchema, TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX } from "@sin/core";
import { describe, expect, it } from "vitest";
import { CAP_MAX_ERROR, ROUND_LENGTH_MAX_ERROR, ROUNDS_RANGE_ERROR, TIMER_CHECK_ERROR } from "./timerCopy";
import { overMaxError } from "../../test/timerServerMessages";
import { timerErrorsFromServer } from "./timerServerErrors";

// A length path carries the schema's over-maximum message, the case its "or less" copy is for (minor 316).
const errs = (...paths: string[]) => paths.map((path) => overMaxError(path));

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

  it("minor 316 — a 422 on a length that isn't the known maximum says Check the timer under that field", () => {
    const issue = (timer: unknown, field: string) => SectionTimerSchema.safeParse(timer).error!.issues.find((i) => i.path.join(".") === field)!.message;
    const capMax = issue({ format: "amrap", capSeconds: TIMER_CAP_SECONDS_MAX + 1 }, "capSeconds");
    const capMin = issue({ format: "amrap", capSeconds: 0 }, "capSeconds");
    const roundMax = issue({ format: "set_timer", roundSeconds: TIMER_ROUND_SECONDS_MAX + 1, rounds: 1 }, "roundSeconds");
    const roundOdd = issue({ format: "set_timer", roundSeconds: 1.5, rounds: 1 }, "roundSeconds");
    expect(timerErrorsFromServer([{ path: "timer.capSeconds", message: capMax }], "timer")).toEqual({ capSeconds: CAP_MAX_ERROR });
    expect(timerErrorsFromServer([{ path: "timer.capSeconds", message: capMin }], "timer")).toEqual({ capSeconds: TIMER_CHECK_ERROR });
    expect(timerErrorsFromServer([{ path: "timer.roundSeconds", message: roundMax }], "timer")).toEqual({ roundSeconds: ROUND_LENGTH_MAX_ERROR });
    expect(timerErrorsFromServer([{ path: "timer.roundSeconds", message: roundOdd }], "timer")).toEqual({ roundSeconds: TIMER_CHECK_ERROR });
    // Rounds' own copy states the whole range, so it fits any rounds failure.
    expect(timerErrorsFromServer([{ path: "timer.rounds", message: "anything" }], "timer")).toEqual({ rounds: ROUNDS_RANGE_ERROR });
  });

  it("never echoes the server's message", () => {
    const out = timerErrorsFromServer(errs("timer.rounds", "timer", "timer.capSeconds"), "timer");
    expect(JSON.stringify(out)).not.toContain("SERVER-SECRET");
  });
});
