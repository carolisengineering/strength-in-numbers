import { RECORD_TYPE_VALUES, type PersonalRecord } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { formatRecordValue, formatSeconds } from "../units/format";
import { buildRecordCards } from "./recordCards";
import { recordLabel, recordLine, shortRecordLabel, sortRecords } from "./labels";

describe("18.1 AC26 — record labels", () => {
  it("both functions name the three new types the same way", () => {
    for (const fn of [recordLabel, shortRecordLabel]) {
      expect(fn("max_calories")).toBe("Most calories");
      expect(fn("max_distance")).toBe("Longest distance");
      expect(fn("max_duration")).toBe("Longest hold");
    }
  });
  it("every record type has a non-empty name", () => {
    for (const t of RECORD_TYPE_VALUES) {
      expect(recordLabel(t)).not.toBe("");
      expect(shortRecordLabel(t)).not.toBe("");
    }
  });
});

describe("18.1 AC27 — record values", () => {
  it.each<[number, "cal" | "m" | "s", "kg" | "lb", string]>([
    [20, "cal", "kg", "20 cal"],
    [1200, "cal", "lb", "1,200 cal"],
    [40, "m", "lb", "40 m"],
    [1200, "m", "kg", "1,200 m"],
    [12.5, "m", "kg", "12.5 m"],
    [12.192, "m", "lb", "12.192 m"],
    [90, "s", "kg", "1 min 30 s"],
  ])("%s %s (%s) → %s", (value, unit, pref, text) => {
    expect(formatRecordValue(value, unit, pref)).toBe(text);
  });
  it.each([
    [45, "45 s"],
    [90, "1 min 30 s"],
    [120, "2 min"],
    [3725, "1 h 2 min 5 s"],
    [0, "0 s"],
    [60, "1 min"],
    [3600, "1 h"],
    [3601, "1 h 1 s"],
  ])("formatSeconds(%i) → %s", (seconds, text) => {
    expect(formatSeconds(seconds)).toBe(text);
  });
});

const card = (r: Partial<Record<keyof PersonalRecord, unknown>>) =>
  buildRecordCards({ records: [makePersonalRecord({ exerciseName: "X", ...r })], workout: makeWorkoutDetail({ exercises: [] }), pref: "kg" })[0]!;

describe("18.1 AC27 — gains", () => {
  it("+5 cal, +10 m, +15 s", () => {
    expect(card({ recordType: "max_calories", unit: "cal", value: 120, previousValue: 115 }).lead.gainText).toBe("+5 cal");
    expect(card({ recordType: "max_distance", unit: "m", value: 50, previousValue: 40 }).lead.gainText).toBe("+10 m");
    expect(card({ recordType: "max_duration", unit: "s", value: 105, previousValue: 90 }).lead.gainText).toBe("+15 s");
  });
  it("Review Focus 1 — a distance gain carries no float noise", () => {
    expect(12.194 - 12.192).not.toBe(0.002);
    expect(card({ recordType: "max_distance", unit: "m", value: 12.194, previousValue: 12.192 }).lead.gainText).toBe("+0.002 m");
  });
});

describe("18.1 AC28 — records list", () => {
  it("reads name — label value (was …), or (first record)", () => {
    const r = makePersonalRecord({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120, previousValue: 110 });
    expect(recordLine(r, "kg")).toBe("Echo Bike — Most calories 120 cal (was 110 cal)");
    expect(recordLine({ ...r, previousValue: null }, "kg")).toBe("Echo Bike — Most calories 120 cal (first record)");
  });
  it("the new types sort after the legacy four, in RECORD_TYPE_VALUES order", () => {
    const one = (recordType: string, unit: string) => makePersonalRecord({ exerciseName: "Carry", recordType, unit, value: 10, previousValue: null });
    const sorted = sortRecords([one("max_duration", "s"), one("heaviest_weight", "kg"), one("max_calories", "cal")]);
    expect(sorted.map((r) => r.recordType)).toEqual(["heaviest_weight", "max_calories", "max_duration"]);
  });
});
