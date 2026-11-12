import { RECORD_TYPE_VALUES, type PersonalRecord } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { formatRecordValue, formatSeconds } from "../units/format";
import { buildRecordLedger } from "./recordLedger";
import { recordLabel, sortRecords } from "./labels";

describe("18.1 AC26 — record labels", () => {
  it("names the three new types", () => {
    expect(recordLabel("max_calories")).toBe("Most calories");
    expect(recordLabel("max_distance")).toBe("Longest distance");
    expect(recordLabel("max_duration")).toBe("Longest hold");
  });
  it("every record type has a non-empty name", () => {
    for (const t of RECORD_TYPE_VALUES) {
      expect(recordLabel(t)).not.toBe("");
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

// Spec 17.6: the gain is the ledger row's.
const gainOf = (r: Partial<Record<keyof PersonalRecord, unknown>>) =>
  buildRecordLedger({ records: [makePersonalRecord({ exerciseName: "X", ...r })], workout: makeWorkoutDetail({ exercises: [] }), pref: "kg", section: "workouts" }).lifts[0]!.rows[0]!.gainText;

describe("18.1 AC27 — gains", () => {
  it("+5 cal, +10 m, +15 s", () => {
    expect(gainOf({ recordType: "max_calories", unit: "cal", value: 120, previousValue: 115 })).toBe("+5 cal");
    expect(gainOf({ recordType: "max_distance", unit: "m", value: 50, previousValue: 40 })).toBe("+10 m");
    expect(gainOf({ recordType: "max_duration", unit: "s", value: 105, previousValue: 90 })).toBe("+15 s");
  });
  it("Review Focus 1 — a distance gain carries no float noise", () => {
    expect(12.194 - 12.192).not.toBe(0.002);
    expect(gainOf({ recordType: "max_distance", unit: "m", value: 12.194, previousValue: 12.192 })).toBe("+0.002 m");
  });
});

// Spec 17.11 AC7: the list's text is `recordParts`'; its calories case is in RecordRows.test.tsx.
describe("18.1 AC28 — records list", () => {
  it("the new types sort after the legacy four, in RECORD_TYPE_VALUES order", () => {
    const one = (recordType: string, unit: string) => makePersonalRecord({ exerciseName: "Carry", recordType, unit, value: 10, previousValue: null });
    const sorted = sortRecords([one("max_duration", "s"), one("heaviest_weight", "kg"), one("max_calories", "cal")]);
    expect(sorted.map((r) => r.recordType)).toEqual(["heaviest_weight", "max_calories", "max_duration"]);
  });
});
