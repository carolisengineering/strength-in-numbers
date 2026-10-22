import { describe, expect, it } from "vitest";
import { ROUTINE_ONE_OFF_DAYS, RoutineSchema, WorkoutDetailSchema } from "@sin/core";
import { makeRoutine, makeRoutineItem, makeWorkoutDetail } from "../../test/workoutFixtures";
import { KEEP_AS_ROUTINE, KEEP_FAILED, KEPT_STATUS, OFFLINE_KEEP, ONE_OFF_TAG } from "./messages";
import { isOneOff, oneOffDay, oneOffMeta, oneOffNote } from "./oneOff";
import { routineSummary } from "./targetFormat";

const FUTURE = "2026-10-30T12:00:00.000Z";
const NOW = Date.parse("2026-10-16T09:00:00Z");

/** A one-off with `n` items; the first `groups.length` carry those superset groups, the rest are loose. */
function routineWith(n: number, groups: number[]) {
  return makeRoutine({
    oneOffUntil: FUTURE,
    items: Array.from({ length: n }, (_, i) => makeRoutineItem({ position: i, supersetGroup: groups[i] ?? null })),
  });
}

describe("10.5 AC3 — the expiry day is the instant in the device time zone", () => {
  it.each([
    ["2026-10-30T12:00:00.000Z", "Europe/London", "Fri 30 Oct"],
    ["2026-10-30T23:30:00.000Z", "Europe/London", "Fri 30 Oct"], // GMT after the clocks change
    ["2026-10-30T23:30:00.000Z", "Pacific/Auckland", "Sat 31 Oct"],
    ["2026-10-30T03:00:00.000Z", "America/Los_Angeles", "Thu 29 Oct"],
    ["2026-10-31T00:30:00+01:00", "Europe/London", "Fri 30 Oct"], // an offset form, the same instant as 23:30Z
  ])("%s in %s → %s", (iso, timeZone, day) => expect(oneOffDay(iso, { timeZone })).toBe(day));

  it("without a zone it uses the device's", () =>
    expect(oneOffDay(FUTURE)).toBe(oneOffDay(FUTURE, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })));
});

describe("10.5 AC2 — the one-off meta line", () => {
  it.each<[number, number[], string]>([
    [6, [1, 1, 2, 2], `6 exercises · 2 supersets · from text · until ${oneOffDay(FUTURE)}`],
    [6, [], `6 exercises · from text · until ${oneOffDay(FUTURE)}`],
    [1, [], `1 exercise · from text · until ${oneOffDay(FUTURE)}`],
    [3, [1, 1], `3 exercises · 1 superset · from text · until ${oneOffDay(FUTURE)}`],
  ])("%i exercises, groups %j", (n, groups, text) => expect(oneOffMeta(routineWith(n, groups), NOW)).toBe(text));

  it("an ordinary routine is just its summary", () => {
    const routine = makeRoutine();
    expect(oneOffMeta(routine, NOW)).toBe(routineSummary(routine));
  });
});

describe("10.5 AC4 — a past expiry drops the date", () => {
  it("meta and note, at and after the instant", () => {
    for (const now of [Date.parse(FUTURE), Date.parse(FUTURE) + 1]) {
      expect(oneOffMeta(routineWith(2, []), now)).toBe("2 exercises · from text");
      expect(oneOffNote(routineWith(2, []), now)).toBe("Leaves your routines when you finish a workout from it. Your workout stays in History.");
    }
  });
});

describe("10.5 AC6 / AC20 — the copy, exactly", () => {
  it("the six strings and the O1 defaults", () => {
    expect(ONE_OFF_TAG).toBe("One-off");
    expect(KEEP_AS_ROUTINE).toBe("Keep as a routine");
    expect(oneOffNote(routineWith(2, []), NOW)).toBe(
      `Leaves your routines when you finish a workout from it, or after 14 days, on ${oneOffDay(FUTURE)}. Your workout stays in History.`,
    );
    expect(ROUTINE_ONE_OFF_DAYS).toBe(14);
    expect([KEPT_STATUS, KEEP_FAILED, OFFLINE_KEEP]).toEqual([
      "Kept in your routines.",
      "Couldn't keep this routine — try again.",
      "You're offline — try again when connected",
    ]);
  });

  it("isOneOff", () => {
    expect(isOneOff({ oneOffUntil: FUTURE })).toBe(true);
    expect(isOneOff({ oneOffUntil: null })).toBe(false);
  });
});

describe("10.5 AC21 — the fields are required", () => {
  it("RoutineSchema / WorkoutDetailSchema reject a body without them", () => {
    const routine: Record<string, unknown> = { ...makeRoutine() };
    delete routine["oneOffUntil"];
    expect(RoutineSchema.safeParse(routine).success).toBe(false);
    const detail: Record<string, unknown> = { ...makeWorkoutDetail() };
    delete detail["routineIsOneOff"];
    expect(WorkoutDetailSchema.safeParse(detail).success).toBe(false);
  });
});
