import type { RoundTime, SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { timesLine } from "./timesLine";

const setTimer: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const amrap: SectionTimer = { format: "amrap", capSeconds: 900 };
const timeCap: SectionTimer = { format: "time_cap", capSeconds: 900 };
const r = (round: number, seconds: number): RoundTime => ({ round, seconds });

describe("10.7 AC20 — times line", () => {
  it.each<[string, SectionTimer, RoundTime[], string | null]>([
    ["a Set Timer lists round lengths", setTimer, [r(1, 221), r(2, 218), r(3, 210)], "Rounds 3:41 · 3:38 · 3:30"],
    ["an AMRAP lists round ends", amrap, [r(1, 250), r(2, 515), r(3, 770)], "Round ends 4:10 · 8:35 · 12:50"],
    ["a skipped round shows a dash", timeCap, [r(1, 250), r(3, 770)], "Round ends 4:10 · – · 12:50"],
    ["out-of-order input prints in round order", setTimer, [r(3, 210), r(1, 221), r(2, 218)], "Rounds 3:41 · 3:38 · 3:30"],
    ["nothing recorded gives no line", setTimer, [], null],
    ["the line starts at round 1", setTimer, [r(2, 218)], "Rounds – · 3:38"],
  ])("%s", (_name, timer, times, expected) => {
    expect(timesLine(timer, times)).toBe(expected);
  });

  it("an hour or more reads through formatClock", () => {
    expect(timesLine(timeCap, [r(1, 3725)])).toBe("Round ends 1:02:05");
  });
});
