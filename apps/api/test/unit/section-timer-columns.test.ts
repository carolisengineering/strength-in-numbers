import type { SectionTimer, SectionTimerInput } from "@sin/core";
import { describe, expect, it } from "vitest";
import {
  resultFromColumns,
  roundTimesJson,
  timedFieldsFromColumns,
  timedFieldsJson,
  timerFromColumns,
  timerToColumns,
  type ResultColumns,
} from "../../src/repositories/section-timer-columns.js";

const NONE = { timer_format: null, timer_round_s: null, timer_rounds: null, timer_cap_s: null };

describe("09.5 AC10 — column mapping", () => {
  it.each<[SectionTimer, Record<string, unknown>]>([
    [{ format: "set_timer", roundSeconds: 300, rounds: 5 }, { timer_format: "set_timer", timer_round_s: 300, timer_rounds: 5, timer_cap_s: null }],
    [{ format: "amrap", capSeconds: 720 }, { timer_format: "amrap", timer_round_s: null, timer_rounds: null, timer_cap_s: 720 }],
    [{ format: "time_cap", capSeconds: 900 }, { timer_format: "time_cap", timer_round_s: null, timer_rounds: null, timer_cap_s: 900 }],
    [{ format: "time_cap", capSeconds: null }, { timer_format: "time_cap", timer_round_s: null, timer_rounds: null, timer_cap_s: null }],
  ])("round trip %j", (timer, columns) => {
    expect(timerToColumns(timer)).toEqual(columns);
    expect(timerFromColumns(timerToColumns(timer))).toEqual(timer);
  });

  it("a time cap sent without its cap is stored NULL and read back as capSeconds: null", () => {
    const input: SectionTimerInput = { format: "time_cap" };
    const columns = timerToColumns(input);
    expect(columns.timer_cap_s).toBeNull();
    expect(timerFromColumns(columns)).toEqual({ format: "time_cap", capSeconds: null });
    expect(Object.keys(timerFromColumns(columns)!)).toEqual(["format", "capSeconds"]);
  });

  it("untimed: null and undefined both give all-NULL columns, and NULL columns read null", () => {
    expect(timerToColumns(null)).toEqual(NONE);
    expect(timerToColumns(undefined)).toEqual(NONE);
    expect(timerFromColumns(NONE)).toBeNull();
  });

  it("the timer keys come out in schema order", () => {
    expect(Object.keys(timerFromColumns({ ...NONE, timer_format: "set_timer", timer_round_s: 300, timer_rounds: 5 })!)).toEqual([
      "format",
      "roundSeconds",
      "rounds",
    ]);
  });

  it("an unknown stored format is a server bug, not a silent null", () => {
    expect(() => timerFromColumns({ ...NONE, timer_format: "emom" })).toThrow();
  });

  const empty: ResultColumns = { result_rounds: null, result_reps: null, result_finish_s: null, result_capped: false };
  it.each<[string, ResultColumns, unknown]>([
    ["all empty → null", empty, null],
    ["capped with rounds null (Review Focus 1)", { ...empty, result_reps: 7, result_capped: true }, { rounds: null, reps: 7, finishSeconds: null, capped: true }],
    ["AMRAP {0,0}", { ...empty, result_rounds: 0, result_reps: 0 }, { rounds: 0, reps: 0, finishSeconds: null, capped: false }],
    ["finish time", { ...empty, result_finish_s: 860 }, { rounds: null, reps: null, finishSeconds: 860, capped: false }],
  ])("resultFromColumns: %s", (_name, columns, expected) => {
    expect(resultFromColumns(columns)).toEqual(expected);
  });

  it("roundTimesJson aggregates by round number, [] when none, from the given column reference", () => {
    const sql = roundTimesJson("s.id");
    expect(sql.sql).toContain("ORDER BY r.round_no");
    expect(sql.sql).toContain("r.workout_section_id = s.id");
    expect(sql.sql).toContain("'[]'::json");
    expect(sql.values).toEqual([]);
  });
});

describe("09.5 AC25 — timedFieldsFromColumns, the one mapping History and the detail share (#247)", () => {
  const NO_RESULT = { result_rounds: null, result_reps: null, result_finish_s: null, result_capped: false };
  const rounds = [{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }];

  it("a Set Timer row: its timer, no result, its round times", () => {
    expect(timedFieldsFromColumns({ timer_format: "set_timer", timer_round_s: 300, timer_rounds: 5, timer_cap_s: null, ...NO_RESULT, round_times: rounds })).toEqual({
      timer: { format: "set_timer", roundSeconds: 300, rounds: 5 },
      result: null,
      roundTimes: rounds,
    });
  });

  it("an AMRAP row with a result", () => {
    const row = { timer_format: "amrap", timer_round_s: null, timer_rounds: null, timer_cap_s: 720, ...NO_RESULT, result_rounds: 5, result_reps: 7, round_times: [] };
    expect(timedFieldsFromColumns(row)).toEqual({ timer: { format: "amrap", capSeconds: 720 }, result: { rounds: 5, reps: 7, finishSeconds: null, capped: false }, roundTimes: [] });
  });

  it("an all-null row: untimed, no result, no rounds", () => {
    expect(timedFieldsFromColumns({ ...NONE, ...NO_RESULT, round_times: [] })).toEqual({ timer: null, result: null, roundTimes: [] });
  });

  it("timedFieldsJson('s') names every timer and result column, then the round times, with no bound values", () => {
    const sql = timedFieldsJson("s");
    for (const col of ["timer_format", "timer_round_s", "timer_rounds", "timer_cap_s", "result_rounds", "result_reps", "result_finish_s", "result_capped"]) {
      expect(sql.sql).toContain(`'${col}', s.${col}`);
    }
    expect(sql.sql).toContain("'round_times', COALESCE(");
    expect(sql.values).toEqual([]);
  });
});
