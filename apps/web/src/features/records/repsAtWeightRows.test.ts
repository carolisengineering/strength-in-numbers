import type { PersonalRecord } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord } from "../../test/workoutFixtures";
import { sortRecords } from "./labels";
import { recordsToShow, REPS_AT_WEIGHT_SHOWN } from "./repsAtWeightRows";

const ROOT = "10000000-0000-4000-8000-0000000000e1";
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const reps = (atWeightKg: number, day: number): PersonalRecord =>
  makePersonalRecord({
    exerciseId: ROOT,
    sourceExerciseId: ROOT,
    exerciseName: "Lateral Raise",
    recordType: "max_reps_at_weight",
    unit: "reps",
    value: 8,
    previousValue: null,
    atWeightKg,
    achievedAt: at(day),
    localDate: at(day).slice(0, 10),
  });
const heaviest = makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Lateral Raise", recordType: "heaviest_weight", value: 27.5, achievedAt: at(1) });
const weights = (shown: readonly PersonalRecord[]) => shown.filter((r) => r.recordType === "max_reps_at_weight").map((r) => r.atWeightKg);

describe("07.5 AC39 — the 5 most recent weights, heaviest first", () => {
  // 10…27.5 kg; the five newest are 12.5, 15, 22.5, 25 and 27.5.
  const eight = sortRecords([heaviest, reps(10, 2), reps(12.5, 20), reps(15, 21), reps(17.5, 3), reps(20, 4), reps(22.5, 22), reps(25, 23), reps(27.5, 24)]);

  it("collapsed: the other types, then the five newest weights drawn heaviest first", () => {
    expect(REPS_AT_WEIGHT_SHOWN).toBe(5);
    const { shown, weights: n } = recordsToShow(eight, false);
    expect(n).toBe(8);
    expect(shown[0]).toBe(heaviest);
    expect(weights(shown)).toEqual([27.5, 25, 22.5, 15, 12.5]);
  });
  it("expanded: every weight, heaviest first", () => {
    expect(weights(recordsToShow(eight, true).shown)).toEqual([27.5, 25, 22.5, 20, 17.5, 15, 12.5, 10]);
  });
  it("five or fewer weights: all of them", () => {
    const five = sortRecords([reps(10, 1), reps(12.5, 2), reps(15, 3), reps(17.5, 4), reps(20, 5)]);
    expect(recordsToShow(five, false)).toEqual({ shown: five, weights: 5 });
  });
  it("equal dates: the heavier takes the last slot", () => {
    const six = sortRecords([reps(10, 9), reps(12.5, 9), reps(15, 20), reps(17.5, 21), reps(20, 22), reps(22.5, 23)]);
    expect(weights(recordsToShow(six, false).shown)).toEqual([22.5, 20, 17.5, 15, 12.5]);
  });
});
