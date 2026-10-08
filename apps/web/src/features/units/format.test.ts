import { describe, expect, it } from "vitest";
import { RECORD_UNIT_VALUES } from "@sin/core";
import { formatRecordValue, formatVolumeKg, formatWeightKg } from "./format";

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
