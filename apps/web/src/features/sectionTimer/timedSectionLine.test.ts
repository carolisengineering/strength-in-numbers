import { sectionScore, type SectionTimer, type TimedSectionSummary } from "@sin/core";
import { describe, expect, it } from "vitest";
import { timedMore } from "./timerCopy";
import { historyTimedLines, timedSectionLine } from "./timedSectionLine";

const setTimer: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const amrap: SectionTimer = { format: "amrap", capSeconds: 720 };

const mainScore = sectionScore({
  timer: setTimer,
  result: null,
  roundTimes: [
    { round: 1, seconds: 221 },
    { round: 2, seconds: 218 },
    { round: 3, seconds: 210 },
    { round: 4, seconds: 205 },
    { round: 5, seconds: 208 },
  ],
});
const finisherScore = sectionScore({ timer: amrap, result: { rounds: 5, reps: 7, capped: false, finishSeconds: null }, roundTimes: [] });

const summary = (position: number, name: string, timer: SectionTimer, score: TimedSectionSummary["score"]): TimedSectionSummary => ({
  id: `00000000-0000-4000-8000-00000000000${position}` as TimedSectionSummary["id"],
  position,
  name,
  timer,
  score,
});

describe("10.7 AC21 — History lines (pure)", () => {
  it("the exact line", () => {
    expect(timedSectionLine(summary(0, "Main", setTimer, mainScore))).toBe("Main · Set Timer 5 × 5:00 · total 17:42");
  });

  it("keeps the first two scored sections in position order and counts the rest", () => {
    const list = [summary(2, "C", amrap, finisherScore), summary(0, "A", setTimer, mainScore), summary(1, "B", amrap, finisherScore)];
    expect(historyTimedLines(list)).toEqual({
      lines: ["A · Set Timer 5 × 5:00 · total 17:42", "B · AMRAP 12:00 · 5 rounds + 7 reps"],
      more: 1,
    });
  });

  it("skips unscored sections, and they don't count toward more", () => {
    const list = [summary(0, "A", setTimer, null), summary(1, "B", amrap, finisherScore), summary(2, "C", setTimer, null), summary(3, "D", setTimer, mainScore)];
    expect(historyTimedLines(list)).toEqual({
      lines: ["B · AMRAP 12:00 · 5 rounds + 7 reps", "D · Set Timer 5 × 5:00 · total 17:42"],
      more: 0,
    });
  });

  it("an empty list gives no lines", () => {
    expect(historyTimedLines([])).toEqual({ lines: [], more: 0 });
  });

  it("timedMore", () => {
    expect(timedMore(1)).toBe("+1 more");
    expect(timedMore(3)).toBe("+3 more");
  });
});
