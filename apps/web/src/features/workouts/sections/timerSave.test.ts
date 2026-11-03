import type { RoundTime, SectionResult, SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { makeTimedSection } from "../../../test/workoutFixtures";
import { decideTimerSave, type TimerSaveDecision } from "./timerSave";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };
const CAP15: SectionTimer = { format: "time_cap", capSeconds: 900 };
const r = (round: number, seconds: number): RoundTime => ({ round, seconds });
const TWO = [r(1, 221), r(2, 218)];

const stored = (timer: SectionTimer | null, roundTimes: RoundTime[] = [], result: SectionResult | null = null) => makeTimedSection({ timer, roundTimes, result });

describe("10.7 AC16 — when a timer change asks first", () => {
  it.each<[string, ReturnType<typeof stored>, SectionTimer | null, TimerSaveDecision["kind"]]>([
    ["recorded, removing the timer", stored(SET5, TWO), null, "confirm"],
    ["recorded, a different format", stored(SET5, TWO), AMRAP12, "confirm"],
    ["recorded, 6 rounds still holds rounds 1–2 (Review Focus 1)", stored(SET5, TWO), { ...SET5, rounds: 6 }, "send"],
    ["recorded, the same timer", stored(SET5, TWO), { ...SET5 }, "unchanged"],
    ["nothing recorded, a different format", stored(SET5), AMRAP12, "send"],
    ["an AMRAP result, to Time Cap", stored(AMRAP12, [], { rounds: 5, reps: 7, capped: false, finishSeconds: null }), CAP15, "confirm"],
    ["untimed, gaining a timer", stored(null), SET5, "send"],
    ["untimed, staying untimed", stored(null), null, "unchanged"],
    ["nothing recorded, removing the timer", stored(SET5), null, "send"],
  ])("%s → %s", (_name, section, next, kind) => {
    expect(decideTimerSave(section, next).kind).toBe(kind);
  });
});

describe("10.7 AC17 — same format, numbers that do not fit", () => {
  it("fewer rounds than recorded asks first", () => {
    expect(decideTimerSave(stored(SET5, [1, 2, 3, 4, 5].map((n) => r(n, 200))), { ...SET5, rounds: 4 }).kind).toBe("confirm");
  });

  it("a round length below a recorded round asks first", () => {
    expect(decideTimerSave(stored(SET5, [r(1, 221), r(2, 290)]), { ...SET5, roundSeconds: 270 }).kind).toBe("confirm");
  });

  it("removing the cap from a capped result asks first", () => {
    const section = stored(CAP15, [], { capped: true, rounds: 4, reps: 7, finishSeconds: null });
    expect(decideTimerSave(section, { format: "time_cap", capSeconds: null }).kind).toBe("confirm");
  });

  it("a longer cap over a finish time is sent plainly", () => {
    const section = stored(CAP15, [], { capped: false, rounds: null, reps: null, finishSeconds: 860 });
    expect(decideTimerSave(section, { format: "time_cap", capSeconds: 1200 }).kind).toBe("send");
  });
});
