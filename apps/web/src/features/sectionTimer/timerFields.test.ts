import type { SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import {
  ENTER_ROUND_LENGTH,
  ENTER_ROUNDS,
  ENTER_TIME_LIMIT,
  CAP_MAX_ERROR,
  ROUND_LENGTH_MAX_ERROR,
  ROUNDS_RANGE_ERROR,
  SECONDS_MAX_ERROR,
} from "./timerCopy";
import { fieldsFromTimer, sameTimer, timerFromFields, toTimerInput, withFormat, type TimerFieldsValue } from "./timerFields";

const fields = (o: Partial<TimerFieldsValue>): TimerFieldsValue => ({ format: "none", rounds: "", roundDigits: "", capDigits: "", ...o });

describe("10.7 AC6 — fields ⇄ timer", () => {
  it.each<SectionTimer | null>([
    null,
    { format: "set_timer", roundSeconds: 1, rounds: 1 },
    { format: "set_timer", roundSeconds: 3600, rounds: 100 },
    { format: "amrap", capSeconds: 1 },
    { format: "amrap", capSeconds: 10_800 },
    { format: "time_cap", capSeconds: null },
    { format: "time_cap", capSeconds: 1 },
    { format: "time_cap", capSeconds: 10_800 },
  ])("%j round-trips", (t) => {
    expect(timerFromFields(fieldsFromTimer(t))).toEqual({ ok: true, timer: t });
  });

  it("null opens on None", () => {
    expect(fieldsFromTimer(null)).toEqual(fields({}));
  });

  it("a different format empties all three strings; the same format keeps them", () => {
    const v = fields({ format: "set_timer", rounds: "5", roundDigits: "500", capDigits: "" });
    expect(withFormat(v, "amrap")).toEqual(fields({ format: "amrap" }));
    expect(withFormat(v, "set_timer")).toBe(v);
  });

  it("a For Time cap is sent with no capSeconds key", () => {
    expect(Object.keys(toTimerInput({ format: "time_cap", capSeconds: null }))).toEqual(["format"]);
    expect(toTimerInput({ format: "time_cap", capSeconds: 900 })).toEqual({ format: "time_cap", capSeconds: 900 });
    expect(toTimerInput({ format: "amrap", capSeconds: 720 })).toEqual({ format: "amrap", capSeconds: 720 });
  });

  it("sameTimer compares structure", () => {
    expect(sameTimer(null, null)).toBe(true);
    expect(sameTimer({ format: "amrap", capSeconds: 720 }, { format: "amrap", capSeconds: 720 })).toBe(true);
    expect(sameTimer({ format: "amrap", capSeconds: 720 }, { format: "amrap", capSeconds: 600 })).toBe(false);
    expect(sameTimer({ format: "amrap", capSeconds: 720 }, { format: "time_cap", capSeconds: 720 })).toBe(false);
    expect(sameTimer(null, { format: "time_cap", capSeconds: null })).toBe(false);
  });
});

describe("10.7 AC5 — field validation (pure)", () => {
  const errorsOf = (v: TimerFieldsValue) => {
    const r = timerFromFields(v);
    return r.ok ? null : r.errors;
  };

  it("an empty Set Timer names both fields at once", () => {
    expect(errorsOf(fields({ format: "set_timer" }))).toEqual({ roundSeconds: ENTER_ROUND_LENGTH, rounds: ENTER_ROUNDS });
  });

  it.each(["0", "101"])("rounds %j are out of range", (rounds) => {
    expect(errorsOf(fields({ format: "set_timer", rounds, roundDigits: "500" }))).toEqual({ rounds: ROUNDS_RANGE_ERROR });
  });

  it("a round length over 60:00", () => {
    expect(errorsOf(fields({ format: "set_timer", rounds: "5", roundDigits: "6001" }))).toEqual({ roundSeconds: ROUND_LENGTH_MAX_ERROR });
  });

  it("seconds of 60 or more", () => {
    expect(errorsOf(fields({ format: "set_timer", rounds: "5", roundDigits: "375" }))).toEqual({ roundSeconds: SECONDS_MAX_ERROR });
    expect(errorsOf(fields({ format: "amrap", capDigits: "375" }))).toEqual({ capSeconds: SECONDS_MAX_ERROR });
  });

  it("an empty AMRAP time limit", () => {
    expect(errorsOf(fields({ format: "amrap" }))).toEqual({ capSeconds: ENTER_TIME_LIMIT });
  });

  it.each(["amrap", "time_cap"] as const)("%s over 180:00", (format) => {
    expect(errorsOf(fields({ format, capDigits: "18001" }))).toEqual({ capSeconds: CAP_MAX_ERROR });
  });

  it("an empty Time Cap is For Time", () => {
    expect(timerFromFields(fields({ format: "time_cap" }))).toEqual({ ok: true, timer: { format: "time_cap", capSeconds: null } });
  });
});
