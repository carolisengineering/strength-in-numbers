import { describe, expect, it } from "vitest";
import { formatStartedTime } from "./format";

// Spec 17.13: the time follows the device's locale (en-US under the suite's pin); no hour cycle is forced.
describe("06.4 AC2 — the start time never prints hour 24", () => {
  it.each([
    ["2026-10-02T00:05:00.000Z", "12:05 AM"],
    ["2026-10-02T12:05:00.000Z", "12:05 PM"],
    ["2026-10-02T23:59:00.000Z", "11:59 PM"],
  ])("%s → %s", (iso, text) => {
    const formatted = formatStartedTime(iso, { timeZone: "UTC" });
    expect(formatted).toBe(text);
    expect(formatted).not.toMatch(/^24:/);
    expect(formatted).not.toBe("24:05");
  });
});
