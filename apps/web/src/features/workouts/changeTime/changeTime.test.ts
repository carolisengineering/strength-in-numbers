import { RETIME_MESSAGES } from "@sin/core";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { inTimeZone } from "../../../test/timeZone";
import { EDIT_COPY } from "../edit/editCopy";
import {
  buildPatch,
  changedGroups,
  changeTimeFailure,
  copyFor,
  dayBounds,
  daysBack,
  initialValues,
  validate,
  type ChangeTimeForm,
  type TimedWorkout,
} from "./changeTime";

const live = (startedAt: string, plannedDurationSeconds: number | null = null): TimedWorkout => ({
  startedAt,
  endedAt: null,
  plannedDurationSeconds,
});
const finished = (startedAt: string, endedAt: string): TimedWorkout => ({ startedAt, endedAt, plannedDurationSeconds: null });
const form = (day: string, time: string, hours = "", minutes = ""): ChangeTimeForm => ({ day, time, hours, minutes });
const LONDON = "Europe/London";
const NOW = new Date("2026-10-18T10:00:00Z");

describe("18.0 AC32 — instants and offsets", () => {
  const stored = live("2026-10-16T16:00:37.512Z");
  it.each([
    ["America/New_York", "2026-10-16", "18:00", "2026-10-16T22:00:00.000Z", -240],
    ["America/New_York", "2026-10-16", "22:30", "2026-10-17T02:30:00.000Z", -240],
    [LONDON, "2025-10-26", "00:30", "2025-10-25T23:30:00.000Z", 60],
    [LONDON, "2025-10-26", "18:00", "2025-10-26T18:00:00.000Z", 0],
    ["America/New_York", "2026-03-08", "02:30", "2026-03-08T07:30:00.000Z", -240],
  ])("%s %s %s → %s (offset %i)", (tz, day, time, startedAt, tzOffsetMinutes) => {
    const result = inTimeZone(tz, () => buildPatch(stored, form(day, time)));
    expect(result).toEqual({ ok: true, patch: { startedAt, tzOffsetMinutes } });
  });
});

describe("18.0 AC30 — initial values and bounds", () => {
  it.each([
    ["finished 1 h", finished("2026-10-16T17:00:00.000Z", "2026-10-16T18:00:00.000Z"), form("2026-10-16", "18:00", "1", "0")],
    ["finished 52 min 29 s", finished("2026-10-16T17:00:00.000Z", "2026-10-16T17:52:29.000Z"), form("2026-10-16", "18:00", "0", "52")],
    ["live, plan 5400", live("2026-10-16T17:00:00.000Z", 5400), form("2026-10-16", "18:00", "1", "30")],
    ["live, plan 3630", live("2026-10-16T17:00:00.000Z", 3630), form("2026-10-16", "18:00", "1", "1")],
    ["live, no plan", live("2026-10-16T17:00:00.000Z"), form("2026-10-16", "18:00")],
  ])("%s", (_, workout, expected) => {
    expect(inTimeZone(LONDON, () => initialValues(workout))).toEqual(expected);
  });

  it("the Day bounds are the floor and today's device-local date", () => {
    expect(inTimeZone(LONDON, () => dayBounds(NOW))).toEqual({ min: "2000-01-01", max: "2026-10-18" });
  });
});

describe("18.0 AC31 — only what changed is sent", () => {
  const hour = finished("2026-10-16T17:00:00.000Z", "2026-10-16T18:00:00.000Z");
  const patchOf = (w: TimedWorkout, f: ChangeTimeForm) => inTimeZone(LONDON, () => buildPatch(w, f));

  it.each([
    ["unchanged", form("2026-10-16", "18:00", "1", "0"), null],
    ["Took only", form("2026-10-16", "18:00", "1", "15"), { durationSeconds: 4500 }],
    ["time only", form("2026-10-16", "19:30", "1", "0"), { startedAt: "2026-10-16T18:30:00.000Z", tzOffsetMinutes: 60 }],
    [
      "both",
      form("2026-10-15", "18:00", "2", "0"),
      { startedAt: "2026-10-15T17:00:00.000Z", tzOffsetMinutes: 60, durationSeconds: 7200 },
    ],
    ["\"01\" equals \"1\"", form("2026-10-16", "18:00", "01", "0"), null],
    ["a blank Hours counts as 0", form("2026-10-16", "18:00", "", "45"), { durationSeconds: 2700 }],
  ])("%s", (_, f, patch) => {
    expect(patchOf(hour, f)).toEqual({ ok: true, patch });
  });
});

describe("18.0 AC36 — clearing Took", () => {
  it("a live workout with a plan sends durationSeconds: null", () => {
    const w = live("2026-10-18T09:05:00.000Z", 3600);
    expect(inTimeZone(LONDON, () => buildPatch(w, form("2026-10-18", "10:05")))).toEqual({ ok: true, patch: { durationSeconds: null } });
  });
  it("a live workout without a plan sends nothing", () => {
    const w = live("2026-10-18T09:05:00.000Z");
    expect(inTimeZone(LONDON, () => buildPatch(w, form("2026-10-18", "10:05")))).toEqual({ ok: true, patch: null });
  });
});

describe("18.0 AC33 — client errors", () => {
  const hour = finished("2026-10-16T17:00:00.000Z", "2026-10-16T18:00:00.000Z");
  const errorsOf = (w: TimedWorkout, f: ChangeTimeForm) => inTimeZone(LONDON, () => buildPatch(w, f));

  it.each([
    ["blank Day", form("", "18:00", "1", "0"), { day: EDIT_COPY.pickDay }],
    ["blank Started at", form("2026-10-16", "", "1", "0"), { time: EDIT_COPY.pickTime }],
    ["Hours 1.5", form("2026-10-16", "18:00", "1.5", "0"), { took: EDIT_COPY.tookWhole }],
    ["Hours 25", form("2026-10-16", "18:00", "25", "0"), { took: EDIT_COPY.tookMax }],
    ["Minutes 60", form("2026-10-16", "18:00", "1", "60"), { took: EDIT_COPY.tookWhole }],
    ["24 h 1 min", form("2026-10-16", "18:00", "24", "1"), { took: EDIT_COPY.tookMax }],
    ["24 h 60 min", form("2026-10-16", "18:00", "24", "60"), { took: EDIT_COPY.tookWhole }],
    ["blank Took on a finished workout", form("2026-10-16", "18:00"), { took: EDIT_COPY.tookRequired }],
  ])("%s", (_, f, errors) => {
    expect(errorsOf(hour, f)).toEqual({ ok: false, errors });
  });

  it("24 h 0 min passes", () => {
    expect(errorsOf(hour, form("2026-10-16", "18:00", "24", "0"))).toEqual({ ok: true, patch: { durationSeconds: 86_400 } });
  });

  it("a stored 30 h workout: changing only the time checks no Took and sends no duration", () => {
    const long = finished("2026-10-14T17:05:00.000Z", "2026-10-15T23:05:00.000Z");
    expect(inTimeZone(LONDON, () => initialValues(long))).toEqual(form("2026-10-14", "18:05", "30", "0"));
    expect(errorsOf(long, form("2026-10-14", "08:00", "30", "0"))).toEqual({
      ok: true,
      patch: { startedAt: "2026-10-14T07:00:00.000Z", tzOffsetMinutes: 60 },
    });
  });
});

describe("18.0 AC33 — validate maps resolveRetime with the pinned copy", () => {
  const today = live("2026-10-18T09:05:00.000Z");
  const check = (w: TimedWorkout, f: ChangeTimeForm) =>
    inTimeZone(LONDON, () => {
      const built = buildPatch(w, f);
      if (!built.ok || built.patch === null) throw new Error("expected a patch");
      return validate(w, built.patch, NOW);
    });

  it.each([
    ["a start tomorrow", today, form("2026-10-19", "10:05"), { time: EDIT_COPY.timeFuture }],
    ["a day before 2000", today, form("1999-12-31", "10:05"), { day: EDIT_COPY.timeFloor }],
    ["live, start 30 min ago, Took 1 h", today, form("2026-10-18", "10:30", "1", "0"), { took: EDIT_COPY.timeEndsInFuture }],
    ["live, plan 2 h, start moved to an hour ago", live("2026-10-18T07:00:00.000Z", 7200), form("2026-10-18", "10:00", "2", "0"), { time: EDIT_COPY.timeEndsInFuture }],
    ["a valid change", today, form("2026-10-16", "18:00", "1", "0"), null],
  ])("%s", (_, w, f, expected) => {
    expect(check(w, f)).toEqual(expected);
  });
});

describe("18.0 AC33 — copyFor covers every RETIME_MESSAGES value", () => {
  it("the message set is the seven this table covers", () => {
    expect(Object.keys(RETIME_MESSAGES).sort()).toEqual(
      ["beforeStart", "endsInFuture", "finishedDurationNull", "floor", "future", "notWithEndedAt", "requiresStart"].sort(),
    );
  });

  it.each([
    ["startedAt", RETIME_MESSAGES.future, "time", EDIT_COPY.timeFuture],
    ["startedAt", RETIME_MESSAGES.floor, "day", EDIT_COPY.timeFloor],
    ["startedAt", RETIME_MESSAGES.endsInFuture, "time", EDIT_COPY.timeEndsInFuture],
    ["durationSeconds", RETIME_MESSAGES.endsInFuture, "took", EDIT_COPY.timeEndsInFuture],
    ["endedAt", RETIME_MESSAGES.endsInFuture, "form", EDIT_COPY.timeEndsInFuture],
    ["durationSeconds", RETIME_MESSAGES.finishedDurationNull, "took", EDIT_COPY.tookRequired],
    ["endedAt", RETIME_MESSAGES.beforeStart, "form", EDIT_COPY.timeGeneric],
    ["tzOffsetMinutes", RETIME_MESSAGES.requiresStart, "form", EDIT_COPY.timeGeneric],
    ["durationSeconds", RETIME_MESSAGES.notWithEndedAt, "form", EDIT_COPY.timeGeneric],
    ["startedAt", "x", "form", EDIT_COPY.timeGeneric],
  ])("(%s, %s) → %s", (path, message, field, text) => {
    expect(copyFor(path, message)).toEqual({ field, text });
  });
});

describe("18.0 AC41 — changeTimeFailure", () => {
  const problem = (status: number, errors?: { path: string; message: string }[]) =>
    new ApiError({
      status,
      type: "about:blank",
      title: "Title",
      detail: "Test problem",
      requestId: "req-1",
      ...(errors ? { errors } : {}),
    });

  it.each([
    ["network", ApiError.network("req-2", new TypeError("Failed to fetch")), { type: "message", text: EDIT_COPY.offline, requestId: "req-2" }],
    ["404", problem(404), { type: "vanished" }],
    [
      "422 on durationSeconds",
      problem(422, [{ path: "durationSeconds", message: RETIME_MESSAGES.endsInFuture }]),
      { type: "fields", errors: { took: EDIT_COPY.timeEndsInFuture } },
    ],
    [
      "422 on tzOffsetMinutes",
      problem(422, [{ path: "tzOffsetMinutes", message: "requires startedAt" }]),
      { type: "fields", errors: { form: EDIT_COPY.timeGeneric } },
    ],
    ["422 with no entries", problem(422), { type: "fields", errors: { form: EDIT_COPY.timeGeneric } }],
    ["500", problem(500), { type: "message", text: EDIT_COPY.changeTimeFailed, requestId: "req-1" }],
    ["not an ApiError", new Error("boom"), { type: "message", text: EDIT_COPY.changeTimeFailed, requestId: null }],
  ])("%s", (_, error, expected) => {
    const result = changeTimeFailure(error);
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain("Test problem");
  });

  it("the first error per field wins", () => {
    const result = changeTimeFailure(
      problem(422, [
        { path: "startedAt", message: RETIME_MESSAGES.future },
        { path: "startedAt", message: RETIME_MESSAGES.endsInFuture },
      ]),
    );
    expect(result).toEqual({ type: "fields", errors: { time: EDIT_COPY.timeFuture } });
  });
});

describe("18.0 AC43 — telemetry helpers", () => {
  it("changedGroups", () => {
    expect(changedGroups({ startedAt: "x", tzOffsetMinutes: 0 })).toBe("start");
    expect(changedGroups({ durationSeconds: null })).toBe("duration");
    expect(changedGroups({ startedAt: "x", tzOffsetMinutes: 0, durationSeconds: 60 })).toBe("both");
  });

  it.each([
    ["two days back", NOW, "2026-10-16T17:00:00.000Z", 2],
    ["earlier today", NOW, "2026-10-18T07:00:00.000Z", 0],
    ["five minutes ahead", NOW, "2026-10-18T10:05:00.000Z", 0],
    ["just past local midnight", new Date("2026-10-18T00:10:00+01:00"), "2026-10-17T23:30:00+01:00", 1],
  ])("daysBack: %s", (_, now, startedAt, expected) => {
    expect(inTimeZone(LONDON, () => daysBack(now, startedAt))).toBe(expected);
  });
});
