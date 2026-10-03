import { describe, expect, it } from "vitest";
import { formatStartedTime } from "./format";

describe("06.4 AC2 — the start time never prints hour 24", () => {
  it.each([
    ["2026-10-02T00:05:00.000Z", "00:05"],
    ["2026-10-02T12:05:00.000Z", "12:05"],
    ["2026-10-02T23:59:00.000Z", "23:59"],
  ])("%s → %s", (iso, text) => {
    const formatted = formatStartedTime(iso, { timeZone: "UTC" });
    expect(formatted).toBe(text);
    expect(formatted).not.toMatch(/^24:/);
  });
});
