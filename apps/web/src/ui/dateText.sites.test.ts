import { describe, expect, it } from "vitest";

import { formatEraseDate } from "../features/account/formatEraseDate";
import { metaLine, type ExerciseRow } from "../features/exercises/exerciseRows";
import { REPORT_FILENAME } from "../features/hevy/import/importReport";
import { MAPPING_FILENAME } from "../features/hevy/mapping/downloadMapping";
import { sentDay } from "../features/hevy/send/sentDay";
import { formatLocalDateWithYear } from "../features/progress/dates";
import { groupByExercise, headlineText } from "../features/progress/exercises";
import { oneOffDay, oneOffMeta } from "../features/routines/oneOff";
import { formatLocalDate, formatStartedAt } from "../features/workouts/format";
import { makeExercise } from "../test/catalogFixtures";
import { pinLocale } from "../test/locale";
import { pinTimeZone } from "../test/timeZone";
import { makePersonalRecord, makeRoutine, makeRoutineItem } from "../test/workoutFixtures";

// Under en-GB every entry point gives the British form, which proves none still pins a locale of its own.
describe("17.13 AC5 — every date site reads the module", () => {
  pinLocale("en-GB");
  pinTimeZone("UTC");

  it("the summary and History rows", () => {
    expect(formatLocalDate("2026-10-06")).toBe("Tue 6 Oct");
  });

  it("the Progress readout and sessions rows", () => {
    expect(formatLocalDateWithYear("2026-10-06")).toBe("Tue, 6 Oct 2026");
  });

  it("the edit banner, the live header's Started and the Finish dialogs", () => {
    expect(formatStartedAt("2026-10-14T17:05:00Z", { timeZone: "Europe/London" })).toBe("Wed 14 Oct, 18:05");
  });

  it("Hevy's sent line", () => {
    expect(sentDay("2026-10-24T12:00:00Z")).toBe("Sat 24 Oct");
  });

  it("a one-off routine's day and its meta line", () => {
    const until = "2099-10-30T12:00:00.000Z";
    expect(oneOffDay(until)).toBe("Fri 30 Oct");
    const routine = makeRoutine({ oneOffUntil: until, items: [makeRoutineItem({ position: 0 })] });
    expect(oneOffMeta(routine, Date.parse("2099-10-20T00:00:00Z"))).toBe("1 exercise · from text · until Fri 30 Oct");
  });

  it("the erase date", () => {
    expect(formatEraseDate("2026-11-13T02:00:00.000Z", "UTC")).toBe("13 November 2026");
  });

  it("the Exercises rows' Last logged", () => {
    const row: ExerciseRow = { row: makeExercise({ modality: "calories" }), lastLoggedOn: "2026-10-24", source: "builtin" };
    expect(metaLine(row, "2026-11-01", true)).toBe("Last logged Sat 24 Oct · Calories");
  });

  it("the Records list's headline", () => {
    const [entry] = groupByExercise([
      makePersonalRecord({ recordType: "best_est_1rm", value: 122.5, unit: "kg", achievedAt: "2026-10-06T10:00:00.000Z", localDate: "2026-10-06" }),
    ]);
    expect(headlineText(entry!, "kg")).toBe("Est. 1-rep max 122.5 kg · Tue 6 Oct");
  });
});

describe("17.13 AC7 — nothing else changes", () => {
  it("the web's own download names carry no date", () => {
    expect(MAPPING_FILENAME).not.toMatch(/\d/);
    expect(REPORT_FILENAME).not.toMatch(/\d/);
  });
});
