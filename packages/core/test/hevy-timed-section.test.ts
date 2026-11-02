import { describe, expect, it } from "vitest";
import { hevyTimerDurationSeconds, hevyTimerLine, type SectionResult, type TimedSectionData } from "../src/index.js";

const SET_TIMER = { format: "set_timer", roundSeconds: 300, rounds: 5 } as const;
const AMRAP = { format: "amrap", capSeconds: 720 } as const;
const TIME_CAP = { format: "time_cap", capSeconds: 900 } as const;
const rounds = (...seconds: number[]) => seconds.map((s, i) => ({ round: i + 1, seconds: s }));
const result = (o: Partial<SectionResult>): SectionResult => ({ rounds: null, reps: null, finishSeconds: null, capped: false, ...o });
const timed = (timer: TimedSectionData["timer"], o: Partial<Omit<TimedSectionData, "timer">> = {}): TimedSectionData => ({
  timer,
  result: null,
  roundTimes: [],
  ...o,
});

describe("09.5 AC28 — the timer line", () => {
  it.each<[string, TimedSectionData, string]>([
    [
      "Set Timer with five rounds",
      timed(SET_TIMER, { roundTimes: rounds(221, 218, 210, 205, 208) }),
      "Set Timer 5 × 5:00 · 3:41, 3:38, 3:30, 3:25, 3:28 · total 17:42",
    ],
    ["Set Timer with nothing recorded", timed(SET_TIMER), "Set Timer 5 × 5:00"],
    [
      "Set Timer rounds out of order with a gap",
      timed(SET_TIMER, { roundTimes: [{ round: 3, seconds: 210 }, { round: 1, seconds: 221 }] }),
      "Set Timer 5 × 5:00 · 3:41, 3:30 · total 7:11",
    ],
    [
      "AMRAP with readings and a result",
      timed(AMRAP, { roundTimes: rounds(250, 515), result: result({ rounds: 5, reps: 7 }) }),
      "AMRAP 12:00 · 4:10, 8:35 · 5 rounds + 7 reps",
    ],
    ["AMRAP with readings and no result", timed(AMRAP, { roundTimes: rounds(250, 515) }), "AMRAP 12:00 · 4:10, 8:35"],
    ["Time Cap finished", timed(TIME_CAP, { result: result({ finishSeconds: 860 }) }), "Time Cap 15:00 · finish 14:20"],
    [
      "Time Cap capped",
      timed(TIME_CAP, { result: result({ rounds: 4, reps: 7, capped: true }) }),
      "Time Cap 15:00 · Capped · 4 rounds + 7 reps",
    ],
    ["For Time with nothing recorded", timed({ format: "time_cap", capSeconds: null }), "For Time"],
  ])("%s", (_label, s, expected) => {
    expect(hevyTimerLine(s)).toBe(expected);
  });
});

describe("09.5 §6.7 — the marker's duration", () => {
  it.each<[string, TimedSectionData, number | null]>([
    ["Set Timer: the total of the round times", timed(SET_TIMER, { roundTimes: rounds(221, 218, 210, 205, 208) }), 1062],
    ["Set Timer with nothing recorded", timed(SET_TIMER), null],
    ["AMRAP with a result: the cap", timed(AMRAP, { result: result({ rounds: 5, reps: 7 }) }), 720],
    ["AMRAP without a result: the cap", timed(AMRAP), 720],
    ["Time Cap finished: the finish time", timed(TIME_CAP, { result: result({ finishSeconds: 860 }) }), 860],
    ["Time Cap capped: the cap (O1)", timed(TIME_CAP, { result: result({ rounds: 4, reps: 7, capped: true }) }), 900],
    ["Time Cap with no result", timed(TIME_CAP), null],
    ["Time Cap with readings only", timed(TIME_CAP, { roundTimes: rounds(250, 515) }), null],
  ])("%s", (_label, s, expected) => {
    expect(hevyTimerDurationSeconds(s)).toBe(expected);
  });
});
