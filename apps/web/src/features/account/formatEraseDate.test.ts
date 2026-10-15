import { describe, expect, it } from "vitest";

import { formatEraseDate } from "./formatEraseDate";

describe("12 AC21 — the erase date is shown in the profile time zone", () => {
  const iso = "2026-11-13T02:00:00.000Z";
  it.each([
    ["UTC", "UTC", "November 13, 2026"],
    ["America/Los_Angeles (previous day)", "America/Los_Angeles", "November 12, 2026"],
    ["Pacific/Auckland (same day, +13)", "Pacific/Auckland", "November 13, 2026"],
  ])("%s", (_n, zone, expected) => {
    expect(formatEraseDate(iso, zone)).toBe(expected);
  });
  it("falls back to the device zone for an unknown zone, without throwing", () => {
    expect(() => formatEraseDate(iso, "Mars/Olympus_Mons")).not.toThrow();
    expect(formatEraseDate(iso, "Mars/Olympus_Mons")).toMatch(/^November 1[23], 2026$/);
  });
});
