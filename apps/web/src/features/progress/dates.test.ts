import { describe, expect, it } from "vitest";
import { formatLocalDateWithYear, todayLocal } from "./dates";

describe("08.1 AC17 — dates with a year (readout and sessions rows)", () => {
  it("formats a local date with its year, UTC-pinned", () => {
    expect(formatLocalDateWithYear("2026-10-06")).toBe("Tue 6 Oct 2026");
    expect(formatLocalDateWithYear("2025-01-01")).toBe("Wed 1 Jan 2025");
  });

  it("todayLocal is the device's local calendar date", () => {
    expect(todayLocal(new Date(2026, 9, 8, 23, 59))).toBe("2026-10-08");
    expect(todayLocal(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
