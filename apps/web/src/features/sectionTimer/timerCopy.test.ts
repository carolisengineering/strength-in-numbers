import { describe, expect, it } from "vitest";
import * as copy from "./timerCopy";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const components = raw(import.meta.glob(["./*.tsx", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const folder = raw(import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("10.7 AC56 — Phase A copy is pinned", () => {
  it.each<[keyof typeof copy, string]>([
    ["TIMER_LABEL", "Timer"],
    ["ROUNDS_LABEL", "Rounds"],
    ["ROUND_LENGTH_LABEL", "Round length"],
    ["TIME_LIMIT_LABEL", "Time limit"],
    ["CAP_LABEL", "Cap"],
    ["CLOCK_HINT", "Type the digits: 341 is 3:41."],
    ["FOR_TIME_HINT", "Leave empty for For Time, with no cap."],
    ["SECONDS_MAX_ERROR", "Seconds go up to 59."],
    ["ENTER_ROUND_LENGTH", "Enter the round length."],
    ["ENTER_ROUNDS", "Enter the number of rounds."],
    ["ENTER_TIME_LIMIT", "Enter the time limit."],
    ["ROUNDS_RANGE_ERROR", "Rounds go from 1 to 100."],
    ["ROUND_LENGTH_MAX_ERROR", "Keep the round length to 60:00 or less."],
    ["CAP_MAX_ERROR", "Keep it to 180:00 or less."],
    ["TIMER_CHECK_ERROR", "Check the timer and try again."],
    ["GROUP_CAP_LINE", "Only the first 8 exercises are grouped."],
  ])("%s", (name, text) => {
    expect(copy[name]).toBe(text);
  });

  it("the format labels", () => {
    expect(copy.TIMER_FORMAT_LABELS).toEqual({ none: "None", set_timer: "Set Timer", amrap: "AMRAP", time_cap: "Time Cap" });
  });

  it("components quote no copy of their own", () => {
    for (const [path, src] of Object.entries(components)) {
      const jsxText = [...stripComments(src).matchAll(/>\s*([A-Za-z][^<>{}]*[a-z.])\s*</g)].map((m) => m[1]);
      expect(jsxText, path).toEqual([]);
    }
  });
});

describe("10.7 AC56 — Phase B copy is pinned (sectionTimer)", () => {
  it.each<[keyof typeof copy, string]>([
    ["TIMES_ROUNDS_PREFIX", "Rounds "],
    ["TIMES_READINGS_PREFIX", "Round ends "],
    ["TIMES_SEPARATOR", " · "],
    ["TIMES_GAP", "–"],
  ])("%s", (name, text) => {
    expect(copy[name]).toBe(text);
  });

  it("timedMore", () => {
    expect(copy.timedMore(2)).toBe("+2 more");
  });
});

describe("10.7 AC5 — the bounds come from @sin/core", () => {
  it("no literal 3600, 10800 or 100 bound in the folder", () => {
    for (const [path, src] of Object.entries(folder)) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/\b3600\b|\b10_?800\b|"100"|\b100\)/);
    }
  });
});
