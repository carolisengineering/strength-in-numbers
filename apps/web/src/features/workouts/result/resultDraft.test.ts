import type { RoundTime, SectionResult, SectionTimer, WorkoutSection } from "@sin/core";
import { describe, expect, it } from "vitest";
import { makeTimedSection } from "../../../test/workoutFixtures";
import {
  addRoundRow,
  clearResultFields,
  diffDraft,
  draftFromSection,
  firstEmptyRow,
  liveTotal,
  resultBody,
  validateDraft,
  withMode,
  type ResultDraft,
} from "./resultDraft";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };
const CAP15: SectionTimer = { format: "time_cap", capSeconds: 900 };
const FOR_TIME: SectionTimer = { format: "time_cap", capSeconds: null };
const rt = (pairs: [number, number][]): RoundTime[] => pairs.map(([round, seconds]) => ({ round, seconds }));
const section = (timer: SectionTimer, roundTimes: RoundTime[] = [], result: SectionResult | null = null) =>
  makeTimedSection({ timer, roundTimes, result }) as WorkoutSection & { timer: SectionTimer };
const setRow = (d: ResultDraft, round: number, digits: string): ResultDraft => ({ ...d, rows: d.rows.map((r) => (r.round === round ? { ...r, digits } : r)) });

describe("10.7 AC28 — Set Timer draft", () => {
  it("one row per planned round; recorded rounds filled; Next is the first blank", () => {
    const d = draftFromSection(section(SET5, rt([[1, 221], [2, 218], [3, 210], [4, 234]])));
    expect(d.rows).toEqual([
      { round: 1, digits: "341" },
      { round: 2, digits: "338" },
      { round: 3, digits: "330" },
      { round: 4, digits: "354" },
      { round: 5, digits: "" },
    ]);
    expect(firstEmptyRow(d)).toBe(5);
  });

  it("liveTotal sums the filled rows; nothing filled is null", () => {
    const d = draftFromSection(section(SET5, rt([[1, 221], [2, 218], [3, 210], [4, 234]])));
    expect(liveTotal(SET5, d)).toBe(883);
    expect(liveTotal(SET5, draftFromSection(section(SET5)))).toBeNull();
    expect(liveTotal(AMRAP12, draftFromSection(section(AMRAP12, rt([[1, 250]]))))).toBeNull();
  });

  it("a row over the round length is that row's error; leaving rounds blank is valid", () => {
    const d = setRow(draftFromSection(section(SET5)), 1, "501");
    expect(validateDraft(SET5, d)).toEqual({ "row:1": "Longer than the round length." });
    expect(validateDraft(SET5, draftFromSection(section(SET5)))).toEqual({});
  });

  it("seconds of 60 or more is the clock field's own error", () => {
    expect(validateDraft(SET5, setRow(draftFromSection(section(SET5)), 2, "375"))).toEqual({ "row:2": "Seconds go up to 59." });
  });

  it("a Set Timer never has a result body", () => {
    expect(resultBody(draftFromSection(section(SET5, rt([[1, 221]]))))).toBeNull();
  });
});

describe("10.7 AC29 — AMRAP draft", () => {
  const empty = () => draftFromSection(section(AMRAP12));
  it("rounds without reps needs the reps; both give the body", () => {
    expect(validateDraft(AMRAP12, { ...empty(), rounds: "5" })).toEqual({ reps: "Enter the reps." });
    const both = { ...empty(), rounds: "5", reps: "7" };
    expect(validateDraft(AMRAP12, both)).toEqual({});
    expect(resultBody(both)).toEqual({ rounds: 5, reps: 7 });
  });

  it("a saved result with 0 rounds is valid", () => {
    const d = draftFromSection(section(AMRAP12, [], { rounds: 0, reps: 12, finishSeconds: null, capped: false }));
    expect(d).toMatchObject({ rounds: "0", reps: "12" });
    expect(validateDraft(AMRAP12, d)).toEqual({});
  });

  it("readings must increase and stay within the limit; empty rows are ignored", () => {
    let d = addRoundRow(addRoundRow(empty()));
    d = setRow(setRow(d, 1, "410"), 2, "320");
    expect(validateDraft(AMRAP12, d)).toMatchObject({ "row:2": "Must be later than the round before." });
    expect(validateDraft(AMRAP12, setRow(setRow(d, 2, ""), 1, "1250"))).toEqual({ "row:1": "Past the time limit or cap." });
  });

  it("checks against the final draft's other rows, so shifting every reading later is valid", () => {
    let d = draftFromSection(section({ format: "amrap", capSeconds: 900 }, rt([[1, 250], [2, 515], [3, 770]])));
    d = setRow(setRow(setRow(d, 1, "440"), 2, "905"), 3, "1320");
    expect(validateDraft({ format: "amrap", capSeconds: 900 }, d)).toEqual({});
  });

  it("addRoundRow appends the highest + 1 (or 1); at 100 it stops", () => {
    const gapped = draftFromSection(section(AMRAP12, rt([[1, 250], [3, 770]])));
    expect(addRoundRow(gapped).rows.map((r) => r.round)).toEqual([1, 3, 4]);
    expect(addRoundRow(empty()).rows).toEqual([{ round: 1, digits: "" }]);
    const full = { ...empty(), rows: [{ round: 100, digits: "" }] };
    expect(addRoundRow(full)).toBe(full);
  });
});

describe("10.7 AC30 — Time Cap draft", () => {
  const empty = () => draftFromSection(section(CAP15));
  it("finished with a time gives finishSeconds; past the cap is the finish error", () => {
    expect(resultBody({ ...empty(), finishDigits: "1420" })).toEqual({ finishSeconds: 860 });
    expect(validateDraft(CAP15, { ...empty(), finishDigits: "1610" })).toEqual({ finish: "The finish time is past the cap." });
  });

  it("capped with nothing needs rounds or reps; only reps omits rounds", () => {
    const capped = withMode(empty(), "capped");
    expect(resultBody(capped)).toEqual({ capped: true });
    expect(validateDraft(CAP15, capped)).toEqual({ rounds: "Give rounds or reps." });
    const reps = { ...capped, reps: "7" };
    expect(resultBody(reps)).toEqual({ capped: true, reps: 7 });
    expect(Object.keys(resultBody(reps)!)).not.toContain("rounds");
  });

  it("switching the mode empties the other mode's fields", () => {
    const finished = { ...empty(), finishDigits: "1420" };
    const capped = withMode(finished, "capped");
    expect(capped).toMatchObject({ mode: "capped", finishDigits: "" });
    const back = withMode({ ...capped, rounds: "4", reps: "7" }, "finished");
    expect(back).toMatchObject({ mode: "finished", rounds: "", reps: "" });
  });

  it("a saved capped result seeds capped; a For Time section seeds finished", () => {
    expect(draftFromSection(section(CAP15, [], { capped: true, rounds: 4, reps: 7, finishSeconds: null })).mode).toBe("capped");
    expect(draftFromSection(section(FOR_TIME)).mode).toBe("finished");
    expect(draftFromSection(section(CAP15, [], { capped: false, rounds: null, reps: null, finishSeconds: 860 })).finishDigits).toBe("1420");
  });
});

describe("10.7 AC31 / AC33 — diffDraft", () => {
  const amrap = () => section(AMRAP12, rt([[1, 250], [2, 515]]), { rounds: 5, reps: 7, finishSeconds: null, capped: false });

  it("an unchanged draft gives nothing", () => {
    const s = amrap();
    expect(diffDraft(s, draftFromSection(s))).toEqual([]);
  });

  it("emptying a recorded row clears that round, and leaves the result", () => {
    const s = amrap();
    expect(diffDraft(s, setRow(draftFromSection(s), 2, ""))).toEqual([{ kind: "round", round: 2, seconds: null }]);
  });

  it("Clear result clears the result and leaves the rounds", () => {
    const s = amrap();
    const d = clearResultFields(draftFromSection(s));
    expect(d).toMatchObject({ rounds: "", reps: "", finishDigits: "", mode: "finished" });
    expect(diffDraft(s, d)).toEqual([{ kind: "result", body: null }]);
  });

  it("round writes come before the result write", () => {
    const s = amrap();
    const d = { ...setRow(draftFromSection(s), 2, "545"), reps: "9" };
    expect(diffDraft(s, d)).toEqual([
      { kind: "round", round: 2, seconds: 345 },
      { kind: "result", body: { rounds: 5, reps: 9 } },
    ]);
  });

  it("a Set Timer draft never yields a result write", () => {
    const s = section(SET5, rt([[1, 221]]));
    expect(diffDraft(s, setRow(draftFromSection(s), 2, "338"))).toEqual([{ kind: "round", round: 2, seconds: 218 }]);
  });

  it("a row typed as 0:00 is empty", () => {
    const s = section(SET5, rt([[1, 221]]));
    expect(diffDraft(s, setRow(draftFromSection(s), 1, "0"))).toEqual([{ kind: "round", round: 1, seconds: null }]);
  });
});
