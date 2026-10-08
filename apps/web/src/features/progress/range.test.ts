import { describe, expect, it } from "vitest";
import { RANGES, RANGE_CHIP, emptyRangeText, rangeLabel, rangeStart } from "./range";

describe("08.1 AC1 — range start dates, with month-end clamping", () => {
  it.each([
    ["2026-10-08", "3m", "2026-07-08"],
    ["2026-10-08", "1y", "2025-10-08"],
    ["2026-05-31", "3m", "2026-02-28"],
    ["2028-05-31", "3m", "2028-02-29"],
    ["2028-02-29", "1y", "2027-02-28"],
    ["2026-01-31", "3m", "2025-10-31"],
    ["2026-03-31", "3m", "2025-12-31"],
    ["2000-05-31", "3m", "2000-02-29"],
    ["2100-05-31", "3m", "2100-02-28"],
  ] as const)("%s minus %s → %s", (today, range, expected) => {
    expect(rangeStart(today, range)).toBe(expected);
  });

  it("all has no lower bound", () => {
    expect(rangeStart("2026-10-08", "all")).toBeUndefined();
  });

  it("labels, chips and empty wording per range", () => {
    expect(RANGES).toEqual(["3m", "1y", "all"]);
    expect(RANGES.map((r) => RANGE_CHIP[r])).toEqual(["3M", "1Y", "All"]);
    expect(RANGES.map(rangeLabel)).toEqual(["3 months", "1 year", "all time"]);
    expect(RANGES.map(emptyRangeText)).toEqual([
      "No sessions in the last 3 months",
      "No sessions in the last year",
      "No sessions yet",
    ]);
  });
});
