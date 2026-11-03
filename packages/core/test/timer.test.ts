import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeTimer,
  formatClock,
  resultIssues,
  roundTimeIssues,
  scoreText,
  sectionScore,
  timerChangeKeepsRecorded,
  timerFitsRecorded,
  timersEqual,
  TIMER_ISSUE_CODES,
  TIMER_ISSUE_MESSAGES,
  type RoundTime,
  type SectionResult,
  type SectionScore,
  type SectionTimer,
  type SetSectionResult,
  type TimerIssue,
  type TimerIssueCode,
} from "../src/index.js";

const setTimer: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const amrap: SectionTimer = { format: "amrap", capSeconds: 720 };
const timeCap: SectionTimer = { format: "time_cap", capSeconds: 900 };
const forTime: SectionTimer = { format: "time_cap", capSeconds: null };

const rt = (pairs: Record<number, number>): RoundTime[] =>
  Object.entries(pairs).map(([round, seconds]) => ({ round: Number(round), seconds }));
const result = (r: Partial<SectionResult>): SectionResult => ({ rounds: null, reps: null, finishSeconds: null, capped: false, ...r });
const issue = (path: string, code: TimerIssueCode): TimerIssue => ({ path, code, message: TIMER_ISSUE_MESSAGES[code] });

describe("09.5 AC3 — formatClock / describeTimer", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [221, "3:41"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
    [10800, "3:00:00"],
  ])("formatClock(%i) = %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });

  it.each([
    [setTimer, "Set Timer 5 × 5:00"],
    [amrap, "AMRAP 12:00"],
    [timeCap, "Time Cap 15:00"],
    [forTime, "For Time"],
  ])("describeTimer(%j) = %s", (timer, text) => {
    expect(describeTimer(timer)).toBe(text);
  });

  it("uses the multiplication sign U+00D7", () => {
    expect(describeTimer(setTimer)).toContain("×");
  });
});

describe("09.5 AC3 — sectionScore / scoreText", () => {
  const rows: [string, { timer: SectionTimer | null; result: SectionResult | null; roundTimes: RoundTime[] }, SectionScore | null, string | null][] = [
    [
      "Set Timer with five rounds",
      { timer: setTimer, result: null, roundTimes: rt({ 1: 221, 2: 218, 3: 210, 4: 205, 5: 208 }) },
      { kind: "total_time", seconds: 1062, rounds: 5 },
      "total 17:42",
    ],
    ["Set Timer with a gap", { timer: setTimer, result: null, roundTimes: rt({ 1: 200, 3: 100 }) }, { kind: "total_time", seconds: 300, rounds: 2 }, "total 5:00"],
    ["Set Timer with no rounds", { timer: setTimer, result: null, roundTimes: [] }, null, null],
    ["AMRAP", { timer: amrap, result: result({ rounds: 5, reps: 7 }), roundTimes: [] }, { kind: "rounds_reps", rounds: 5, reps: 7 }, "5 rounds + 7 reps"],
    ["AMRAP singular", { timer: amrap, result: result({ rounds: 1, reps: 1 }), roundTimes: [] }, { kind: "rounds_reps", rounds: 1, reps: 1 }, "1 round + 1 rep"],
    ["AMRAP zero", { timer: amrap, result: result({ rounds: 0, reps: 0 }), roundTimes: [] }, { kind: "rounds_reps", rounds: 0, reps: 0 }, "0 rounds + 0 reps"],
    [
      "AMRAP round times never change the score",
      { timer: amrap, result: result({ rounds: 5, reps: 7 }), roundTimes: rt({ 1: 100, 2: 200 }) },
      { kind: "rounds_reps", rounds: 5, reps: 7 },
      "5 rounds + 7 reps",
    ],
    ["AMRAP with no result", { timer: amrap, result: null, roundTimes: rt({ 1: 100 }) }, null, null],
    ["Time Cap finished", { timer: timeCap, result: result({ finishSeconds: 860 }), roundTimes: [] }, { kind: "finish_time", seconds: 860 }, "finish 14:20"],
    ["For Time finished", { timer: forTime, result: result({ finishSeconds: 3725 }), roundTimes: [] }, { kind: "finish_time", seconds: 3725 }, "finish 1:02:05"],
    [
      "Time Cap capped, rounds and reps",
      { timer: timeCap, result: result({ capped: true, rounds: 4, reps: 7 }), roundTimes: [] },
      { kind: "capped", rounds: 4, reps: 7 },
      "Capped · 4 rounds + 7 reps",
    ],
    ["Time Cap capped, reps only", { timer: timeCap, result: result({ capped: true, reps: 7 }), roundTimes: [] }, { kind: "capped", rounds: null, reps: 7 }, "Capped · 7 reps"],
    ["Time Cap capped, rounds only", { timer: timeCap, result: result({ capped: true, rounds: 4 }), roundTimes: [] }, { kind: "capped", rounds: 4, reps: null }, "Capped · 4 rounds"],
    ["Time Cap capped, singular", { timer: timeCap, result: result({ capped: true, rounds: 1, reps: 1 }), roundTimes: [] }, { kind: "capped", rounds: 1, reps: 1 }, "Capped · 1 round + 1 rep"],
    ["Time Cap with no result", { timer: timeCap, result: null, roundTimes: rt({ 1: 100 }) }, null, null],
    ["untimed", { timer: null, result: null, roundTimes: [] }, null, null],
  ];

  it.each(rows)("%s", (_name, section, score, text) => {
    expect(sectionScore(section)).toEqual(score);
    if (score !== null) expect(scoreText(score)).toBe(text);
  });
});

type Row = [string, () => TimerIssue[], TimerIssue[]];

const roundRows: Row[] = [
  ["Set Timer round 6 of 5", () => roundTimeIssues(setTimer, [], 6, 200), [issue("round", "round_beyond_rounds")]],
  ["Set Timer 301 s of a 300 s round", () => roundTimeIssues(setTimer, [], 1, 301), [issue("seconds", "seconds_over_round")]],
  ["Set Timer both at once", () => roundTimeIssues(setTimer, [], 6, 301), [issue("round", "round_beyond_rounds"), issue("seconds", "seconds_over_round")]],
  ["Set Timer the full round", () => roundTimeIssues(setTimer, [], 5, 300), []],
  ["Set Timer ignores order", () => roundTimeIssues(setTimer, rt({ 1: 100, 3: 50 }), 2, 290), []],
  ["AMRAP over the cap", () => roundTimeIssues(amrap, [], 1, 721), [issue("seconds", "seconds_over_cap")]],
  ["AMRAP at the cap", () => roundTimeIssues(amrap, [], 1, 720), []],
  ["Time Cap over the cap", () => roundTimeIssues(timeCap, [], 3, 901), [issue("seconds", "seconds_over_cap")]],
  ["For Time has no cap", () => roundTimeIssues(forTime, [], 3, 10800), []],
  ["not after the previous round", () => roundTimeIssues(timeCap, rt({ 1: 250, 3: 770 }), 2, 250), [issue("seconds", "seconds_not_after_previous")]],
  ["not before the next round", () => roundTimeIssues(timeCap, rt({ 1: 250, 3: 770 }), 2, 770), [issue("seconds", "seconds_not_before_next")]],
  ["between its neighbors", () => roundTimeIssues(timeCap, rt({ 1: 250, 3: 770 }), 2, 515), []],
  ["re-saving a round with its own value", () => roundTimeIssues(timeCap, rt({ 1: 250, 2: 515, 3: 770 }), 3, 770), []],
  ["changing a round within its neighbors", () => roundTimeIssues(timeCap, rt({ 1: 250, 2: 515, 3: 770 }), 2, 600), []],
  ["round 4 arriving first", () => roundTimeIssues(amrap, [], 4, 400), []],
  ["the nearest neighbors, not the first and last", () => roundTimeIssues(amrap, rt({ 1: 100, 2: 200, 5: 500, 6: 600 }), 3, 199), [issue("seconds", "seconds_not_after_previous")]],
  ["over the cap and behind the previous", () => roundTimeIssues(amrap, rt({ 1: 700 }), 2, 800), [issue("seconds", "seconds_over_cap")]],
  ["before the previous round", () => roundTimeIssues(amrap, rt({ 2: 300 }), 3, 200), [issue("seconds", "seconds_not_after_previous")]],
];

const body = (b: SetSectionResult) => b;
const resultRows: Row[] = [
  ["AMRAP full", () => resultIssues(amrap as never, body({ rounds: 5, reps: 7 })), []],
  ["AMRAP zero", () => resultIssues(amrap as never, body({ rounds: 0, reps: 0 })), []],
  ["AMRAP without rounds", () => resultIssues(amrap as never, body({ reps: 7 })), [issue("rounds", "rounds_required")]],
  ["AMRAP without reps", () => resultIssues(amrap as never, body({ rounds: 5 })), [issue("reps", "reps_required")]],
  ["AMRAP with a finish time", () => resultIssues(amrap as never, body({ rounds: 5, reps: 7, finishSeconds: 600 })), [issue("finishSeconds", "finish_not_allowed")]],
  ["AMRAP capped", () => resultIssues(amrap as never, body({ rounds: 5, reps: 7, capped: true })), [issue("capped", "capped_not_allowed")]],
  ["AMRAP capped: false is absent", () => resultIssues(amrap as never, body({ rounds: 5, reps: 7, capped: false })), []],
  ["AMRAP all empty", () => resultIssues(amrap as never, body({})), [issue("rounds", "nothing_to_record")]],
  ["AMRAP nulls and capped false are empty", () => resultIssues(amrap as never, body({ rounds: null, reps: null, finishSeconds: null, capped: false })), [issue("rounds", "nothing_to_record")]],
  ["Time Cap finished", () => resultIssues(timeCap as never, body({ finishSeconds: 860 })), []],
  ["Time Cap finish at the cap", () => resultIssues(timeCap as never, body({ finishSeconds: 900 })), []],
  ["Time Cap finish past the cap", () => resultIssues(timeCap as never, body({ finishSeconds: 901 })), [issue("finishSeconds", "finish_over_cap")]],
  ["For Time finish", () => resultIssues(forTime as never, body({ finishSeconds: 10800 })), []],
  [
    "Time Cap finish with rounds and reps",
    () => resultIssues(timeCap as never, body({ finishSeconds: 860, rounds: 4, reps: 7 })),
    [issue("rounds", "rounds_reps_not_allowed"), issue("reps", "rounds_reps_not_allowed")],
  ],
  ["Time Cap rounds without a finish or cap hit", () => resultIssues(timeCap as never, body({ rounds: 4 })), [issue("finishSeconds", "finish_required")]],
  ["Time Cap capped", () => resultIssues(timeCap as never, body({ capped: true, rounds: 4, reps: 7 })), []],
  ["Time Cap capped, reps only", () => resultIssues(timeCap as never, body({ capped: true, reps: 7 })), []],
  ["Time Cap capped with a finish time", () => resultIssues(timeCap as never, body({ capped: true, rounds: 4, finishSeconds: 860 })), [issue("finishSeconds", "finish_not_allowed")]],
  ["Time Cap capped with neither", () => resultIssues(timeCap as never, body({ capped: true })), [issue("rounds", "rounds_or_reps_required")]],
  ["For Time capped", () => resultIssues(forTime as never, body({ capped: true, rounds: 4 })), [issue("capped", "capped_needs_cap")]],
  ["Time Cap all empty", () => resultIssues(timeCap as never, body({})), [issue("rounds", "nothing_to_record")]],
];

const fitRows: Row[] = [
  ["same Set Timer fits", () => timerFitsRecorded(setTimer, rt({ 1: 221, 5: 300 }), null), []],
  ["Set Timer rounds below a recorded round", () => timerFitsRecorded({ ...setTimer, rounds: 4 }, rt({ 1: 221, 5: 200 }), null), [issue("timer", "fit_rounds_below_recorded")]],
  ["Set Timer round shorter than a recorded time", () => timerFitsRecorded({ ...setTimer, roundSeconds: 220 }, rt({ 1: 221 }), null), [issue("timer", "fit_round_shorter_than_recorded")]],
  ["Set Timer cannot hold a result", () => timerFitsRecorded(setTimer, [], result({ rounds: 5, reps: 7 })), [issue("timer", "fit_result_on_set_timer")]],
  ["same AMRAP fits", () => timerFitsRecorded(amrap, rt({ 1: 250, 2: 720 }), result({ rounds: 2, reps: 3 })), []],
  ["AMRAP limit below a reading", () => timerFitsRecorded({ format: "amrap", capSeconds: 600 }, rt({ 1: 250, 2: 700 }), null), [issue("timer", "fit_cap_below_reading")]],
  ["same Time Cap fits", () => timerFitsRecorded(timeCap, rt({ 1: 250 }), result({ finishSeconds: 900 })), []],
  ["Time Cap cap below a reading", () => timerFitsRecorded({ format: "time_cap", capSeconds: 240 }, rt({ 1: 250 }), null), [issue("timer", "fit_cap_below_reading")]],
  ["Time Cap cap below the finish", () => timerFitsRecorded({ format: "time_cap", capSeconds: 800 }, [], result({ finishSeconds: 860 })), [issue("timer", "fit_cap_below_finish")]],
  ["Time Cap cap removed while capped", () => timerFitsRecorded(forTime, [], result({ capped: true, rounds: 4 })), [issue("timer", "fit_cap_removed_while_capped")]],
  ["Time Cap cap removed over a finish", () => timerFitsRecorded(forTime, rt({ 1: 5000 }), result({ finishSeconds: 6000 })), []],
  ["Time Cap cap added over a capped result", () => timerFitsRecorded({ format: "time_cap", capSeconds: 1200 }, [], result({ capped: true, rounds: 4 })), []],
];

describe("09.5 AC3 — rule tables with codes", () => {
  it.each(roundRows)("roundTimeIssues: %s", (_name, run, expected) => {
    expect(run()).toEqual(expected);
  });
  it.each(resultRows)("resultIssues: %s", (_name, run, expected) => {
    expect(run()).toEqual(expected);
  });
  it.each(fitRows)("timerFitsRecorded: %s", (_name, run, expected) => {
    expect(run()).toEqual(expected);
  });

  it("lists the 21 codes of §6.9 in table order", () => {
    expect(TIMER_ISSUE_CODES).toEqual([
      "round_beyond_rounds",
      "seconds_over_round",
      "seconds_over_cap",
      "seconds_not_after_previous",
      "seconds_not_before_next",
      "rounds_required",
      "reps_required",
      "finish_not_allowed",
      "capped_not_allowed",
      "rounds_reps_not_allowed",
      "finish_over_cap",
      "finish_required",
      "capped_needs_cap",
      "rounds_or_reps_required",
      "nothing_to_record",
      "fit_rounds_below_recorded",
      "fit_round_shorter_than_recorded",
      "fit_cap_below_reading",
      "fit_cap_below_finish",
      "fit_cap_removed_while_capped",
      "fit_result_on_set_timer",
    ]);
  });

  it("every code has a non-empty static message", () => {
    expect(Object.keys(TIMER_ISSUE_MESSAGES).sort()).toEqual([...TIMER_ISSUE_CODES].sort());
    for (const code of TIMER_ISSUE_CODES) expect(TIMER_ISSUE_MESSAGES[code].length).toBeGreaterThan(0);
    expect(TIMER_ISSUE_MESSAGES.round_beyond_rounds).toBe("beyond the planned rounds");
    expect(TIMER_ISSUE_MESSAGES.fit_cap_below_reading).toBe("doesn't fit the recorded times");
  });

  it("every code is produced by at least one rule row", () => {
    const produced = new Set([...roundRows, ...resultRows, ...fitRows].flatMap(([, run]) => run().map((i) => i.code)));
    expect(produced).toEqual(new Set(TIMER_ISSUE_CODES));
  });
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("09.5 AC3 — single implementation", () => {
  const files = [...sourceFiles(join(ROOT, "apps/api/src")), ...sourceFiles(join(ROOT, "apps/web/src")), ...sourceFiles(join(ROOT, "packages/core/src"))];
  const own = join(ROOT, "packages/core/src/timer.ts");

  it("scans the app sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(own);
  });

  it.each([/function formatClock\b/, /function sectionScore\b/, /function scoreText\b/, /["'`]Set Timer /])("only timer.ts matches %s", (pattern) => {
    const hits = files.filter((f) => !/\.test\.tsx?$/.test(f) && pattern.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual(["packages/core/src/timer.ts"]);
  });

  // Deferred minor 297: the web's `formatDuration` was a byte-for-byte copy of `formatClock`; it stays deleted.
  it("no source defines formatDuration (the web calls formatClock)", () => {
    const hits = files.filter((f) => !/\.test\.tsx?$/.test(f) && /\bformatDuration\b/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

describe("09.5 AC13 — timersEqual / timerChangeKeepsRecorded (one implementation of the keep rule)", () => {
  it("timersEqual compares by format and fields, not key order", () => {
    expect(timersEqual(setTimer, { rounds: 5, roundSeconds: 300, format: "set_timer" } as SectionTimer)).toBe(true);
    expect(timersEqual(setTimer, { ...setTimer, rounds: 6 })).toBe(false);
    expect(timersEqual(amrap, timeCap)).toBe(false);
    expect(timersEqual(forTime, { format: "time_cap", capSeconds: null })).toBe(true);
    expect(timersEqual(null, null)).toBe(true);
    expect(timersEqual(amrap, null)).toBe(false);
  });

  it.each<[string, SectionTimer | null, SectionTimer | null, RoundTime[], SectionResult | null, boolean]>([
    ["nothing recorded keeps anything", amrap, setTimer, [], null, true],
    ["same format that fits keeps", setTimer, { ...setTimer, rounds: 6 }, rt({ 1: 221 }), null, true],
    ["same format that doesn't fit", setTimer, { ...setTimer, rounds: 2 }, rt({ 3: 200 }), null, false],
    ["a different format never keeps", amrap, timeCap, rt({ 1: 250 }), null, false],
    ["removal never keeps", setTimer, null, rt({ 1: 221 }), null, false],
    ["a result counts as recorded", timeCap, forTime, [], result({ capped: true, rounds: 4 }), false],
    ["adding a timer to an untimed section keeps (nothing to keep)", null, amrap, [], null, true],
  ])("%s", (_name, stored, next, rounds, res, keeps) => {
    expect(timerChangeKeepsRecorded(stored, next, rounds, res)).toBe(keeps);
  });
});
