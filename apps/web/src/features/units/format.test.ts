import { describe, expect, it } from "vitest";
import { RECORD_UNIT_VALUES } from "@sin/core";
import { e1rmSteps, formatE1rmGain, formatRecordByType, formatRecordValue, formatVolumeKg, formatWeightKg, roundedE1rm } from "./format";

/** What the API stores for a weight entered in lb: `weight_kg`, rounded to numeric(7,3). */
const storedKg = (lb: number) => Math.round(lb * 0.45359237 * 1000) / 1000;

describe("08.0 AC1 — weight and volume in the lifter's unit", () => {
  it.each([
    [102.5, "102.5 kg"],
    [101.25, "101.25 kg"],
    [60, "60 kg"],
    [6420, "6,420 kg"],
    [0.125, "0.125 kg"],
  ])("kg shows %s as stored → %s", (kg, text) => {
    expect(formatWeightKg(kg, "kg")).toBe(text);
  });

  it.each([
    [100, "220.5 lb"],
    [6420, "14,153.7 lb"],
    [20, "44.1 lb"],
  ])("lb converts %s kg → %s (1 decimal max)", (kg, text) => {
    expect(formatWeightKg(kg, "lb")).toBe(text);
  });

  it("never prints a trailing .0", () => {
    expect(formatWeightKg(storedKg(100), "lb")).toBe("100 lb");
    expect(formatVolumeKg(1000, "kg")).toBe("1,000 kg");
  });

  it("volume uses the same conversion", () => {
    expect(formatVolumeKg(6420, "kg")).toBe("6,420 kg");
    expect(formatVolumeKg(6420, "lb")).toBe("14,153.7 lb");
  });

  it("formatRecordValue maps each record unit", () => {
    expect(formatRecordValue(102.5, "kg", "kg")).toBe("102.5 kg");
    expect(formatRecordValue(100, "kg", "lb")).toBe("220.5 lb");
    expect(formatRecordValue(6420, "kg_reps", "kg")).toBe("6,420 kg");
    expect(formatRecordValue(12, "reps", "lb")).toBe("12 reps");
    expect(formatRecordValue(1, "reps", "kg")).toBe("1 rep");
  });
});

describe("08.0 AC2 — lb round trip and every record unit", () => {
  it.each([225, 135, 315, 45])("%s lb entered → stored kg → shown as %s lb", (lb) => {
    expect(formatWeightKg(storedKg(lb), "lb")).toBe(`${lb} lb`);
  });

  it("a volume summed from lb-entered sets round-trips", () => {
    // 225 lb × 5 reps: the API sums weight_kg × reps.
    expect(formatVolumeKg(storedKg(225) * 5, "lb")).toBe("1,125 lb");
  });

  it("handles every RECORD_UNIT_VALUES member", () => {
    for (const unit of RECORD_UNIT_VALUES) {
      expect(() => formatRecordValue(10, unit, "kg")).not.toThrow();
      expect(formatRecordValue(10, unit, "kg")).not.toBe("");
    }
  });
});

describe("17.2 AC21 / AC22 / AC23 — e1RM display rounding", () => {
  it.each([
    [137.08, "kg", "137 kg"],
    [137.25, "kg", "137.5 kg"], // half up on the 0.5 kg step
    [137.24, "kg", "137 kg"],
    [137.5, "kg", "137.5 kg"],
    [storedKg(225), "lb", "225 lb"], // 224.9998 lb stored, shown as 225
    [102.3, "lb", "226 lb"], // 225.54 lb
    [storedKg(225.4), "lb", "225 lb"],
  ] as const)("%s kg for a %s account reads %s", (kg, pref, text) => {
    expect(roundedE1rm(kg, pref)).toBe(text);
  });

  it("e1rmSteps is an integer step count in the display unit", () => {
    expect(e1rmSteps(137.25, "kg")).toBe(275);
    expect(e1rmSteps(storedKg(225), "lb")).toBe(225);
  });

  it.each([
    [137, 138.2, "kg", "+1 kg"],
    [137, 137.5, "kg", "+0.5 kg"],
    [137.5, 138, "kg", "+0.5 kg"],
    [storedKg(224.6), storedKg(226), "lb", "+1 lb"],
    [storedKg(220), storedKg(225), "lb", "+5 lb"],
  ] as const)("the gain from %s to %s kg for a %s account is %s", (prev, next, pref, text) => {
    expect(formatE1rmGain(next, prev, pref)).toBe(text);
  });

  it("is null when the rounded values do not rise", () => {
    expect(formatE1rmGain(137.2, 137, "kg")).toBeNull(); // both round to 137
    expect(formatE1rmGain(137, 138, "kg")).toBeNull(); // a lower value
    expect(formatE1rmGain(storedKg(225.2), storedKg(224.9), "lb")).toBeNull();
  });

  it("formatRecordByType rounds e1RM and leaves other types as formatRecordValue prints them", () => {
    expect(formatRecordByType("best_est_1rm", 137.08, "kg", "kg")).toBe("137 kg");
    expect(formatRecordByType("heaviest_weight", 102.5, "kg", "kg")).toBe("102.5 kg");
    expect(formatRecordByType("max_reps", 12, "reps", "kg")).toBe("12 reps");
  });
});
