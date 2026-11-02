import { describe, expect, it } from "vitest";
import {
  RESULT_REPS_MAX,
  RESULT_ROUNDS_MAX,
  ROUND_PARAM_MESSAGE,
  SectionRoundParamsSchema,
  SectionTimerInputSchema,
  SectionTimerSchema,
  SetRoundTimeSchema,
  SetSectionResultSchema,
  TIMER_CAP_SECONDS_MAX,
  TIMER_FORMAT_VALUES,
  TIMER_ROUND_SECONDS_MAX,
  TIMER_ROUNDS_MAX,
} from "../src/index.js";

type Parsed = { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };
const paths = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => i.path.join(".")));
const messages = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe("09.5 AC2 — timer schema", () => {
  it("pins the formats and limits", () => {
    expect(TIMER_FORMAT_VALUES).toEqual(["set_timer", "amrap", "time_cap"]);
    expect([TIMER_ROUND_SECONDS_MAX, TIMER_ROUNDS_MAX, TIMER_CAP_SECONDS_MAX, RESULT_ROUNDS_MAX, RESULT_REPS_MAX]).toEqual([
      3600, 100, 10800, 999, 9999,
    ]);
  });

  const base = {
    set_timer: { format: "set_timer", roundSeconds: 300, rounds: 5 },
    amrap: { format: "amrap", capSeconds: 720 },
    time_cap: { format: "time_cap", capSeconds: 900 },
  } as const;
  const fields: [keyof typeof base, string, number][] = [
    ["set_timer", "roundSeconds", TIMER_ROUND_SECONDS_MAX],
    ["set_timer", "rounds", TIMER_ROUNDS_MAX],
    ["amrap", "capSeconds", TIMER_CAP_SECONDS_MAX],
    ["time_cap", "capSeconds", TIMER_CAP_SECONDS_MAX],
  ];
  const rows = fields.flatMap(([format, field, max]) =>
    (
      [
        [1, true],
        [max, true],
        [0, false],
        [max + 1, false],
        [1.5, false],
        ["300", false],
      ] as const
    ).map(([value, ok]) => [format, field, value, ok] as const),
  );

  it.each(rows)("%s.%s = %j → ok %s", (format, field, value, ok) => {
    for (const schema of [SectionTimerSchema, SectionTimerInputSchema]) {
      const r = schema.safeParse({ ...base[format], [field]: value });
      expect(r.success).toBe(ok);
      if (!ok) expect(paths(r)).toEqual([field]);
    }
  });

  it("rejects a foreign key on its own path", () => {
    expect(paths(SectionTimerSchema.safeParse({ format: "amrap", capSeconds: 720, rounds: 5 }))).toEqual([""]);
    const r = SectionTimerSchema.safeParse({ format: "amrap", capSeconds: 720, rounds: 5 });
    expect(r.success ? [] : r.error!.issues.flatMap((i) => ("keys" in i ? (i.keys as string[]) : []))).toEqual(["rounds"]);
    expect(SectionTimerInputSchema.safeParse({ format: "set_timer", roundSeconds: 300, rounds: 5, capSeconds: 9 }).success).toBe(false);
  });

  it.each([[{}], [{ format: "emom", capSeconds: 60 }], [{ format: null }], [{ format: 3 }]])("%j → unknown timer format", (body) => {
    for (const schema of [SectionTimerSchema, SectionTimerInputSchema]) {
      const r = schema.safeParse(body);
      expect(r.success).toBe(false);
      expect(messages(r)).toEqual(["unknown timer format"]);
      expect(paths(r)).toEqual(["format"]);
    }
  });

  it("a time cap may omit its cap on a request, never on a response", () => {
    expect(SectionTimerInputSchema.safeParse({ format: "time_cap" }).success).toBe(true);
    expect(paths(SectionTimerSchema.safeParse({ format: "time_cap" }))).toEqual(["capSeconds"]);
    expect(SectionTimerSchema.safeParse({ format: "time_cap", capSeconds: null }).success).toBe(true);
    expect(SectionTimerInputSchema.safeParse({ format: "time_cap", capSeconds: null }).success).toBe(true);
    expect(paths(SectionTimerInputSchema.safeParse({ format: "amrap" }))).toEqual(["capSeconds"]);
    expect(paths(SectionTimerInputSchema.safeParse({ format: "amrap", capSeconds: null }))).toEqual(["capSeconds"]);
  });

  it("collects every issue in one body", () => {
    expect(paths(SectionTimerSchema.safeParse({ format: "set_timer", roundSeconds: 0, rounds: 101 })).sort()).toEqual([
      "roundSeconds",
      "rounds",
    ]);
  });
});

describe("09.5 AC2 — result and round-time bodies", () => {
  it.each([
    [{ rounds: 0 }, []],
    [{ rounds: 999 }, []],
    [{ rounds: 1000 }, ["rounds"]],
    [{ rounds: -1 }, ["rounds"]],
    [{ reps: 0 }, []],
    [{ reps: 9999 }, []],
    [{ reps: 10000 }, ["reps"]],
    [{ finishSeconds: 0 }, ["finishSeconds"]],
    [{ finishSeconds: 1 }, []],
    [{ finishSeconds: 10800 }, []],
    [{ finishSeconds: 10801 }, ["finishSeconds"]],
    [{ finishSeconds: 1.5 }, ["finishSeconds"]],
    [{ capped: true }, []],
    [{ capped: "yes" }, ["capped"]],
    [{ rounds: null, reps: null, finishSeconds: null }, []],
    [{}, []],
    [{ rounds: 1, extra: 1 }, [""]],
  ])("SetSectionResultSchema %j → %j", (body, expected) => {
    expect(paths(SetSectionResultSchema.safeParse(body))).toEqual(expected);
  });

  it.each([
    [{ seconds: 0 }, ["seconds"]],
    [{ seconds: 1 }, []],
    [{ seconds: 10800 }, []],
    [{ seconds: 10801 }, ["seconds"]],
    [{ seconds: "60" }, ["seconds"]],
    [{}, ["seconds"]],
    [{ seconds: 60, round: 1 }, [""]],
  ])("SetRoundTimeSchema %j → %j", (body, expected) => {
    expect(paths(SetRoundTimeSchema.safeParse(body))).toEqual(expected);
  });
});

describe("09.5 AC14 — round path parameter", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["100", 100],
  ])("%s → %i", (round, n) => {
    expect(SectionRoundParamsSchema.parse({ id: "x", round })).toEqual({ id: "x", round: n });
  });
  it.each(["0", "101", "03", "3.0", "1e1", " 3", "-1", "", "abc", "999"])("%j → 422 on round (Review Focus 1)", (round) => {
    const r = SectionRoundParamsSchema.safeParse({ id: "x", round });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["round", ROUND_PARAM_MESSAGE]]);
  });
});
