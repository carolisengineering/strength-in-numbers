import { describe, expect, it } from "vitest";
import { inTimeZone } from "./timeZone";

describe("18.0 §10 — the time zone helpers pin the device zone", () => {
  it("inTimeZone applies the zone for the call and restores it", () => {
    const before = process.env["TZ"];
    expect(inTimeZone("America/New_York", () => new Date(2026, 9, 16).getTimezoneOffset())).toBe(240);
    expect(process.env["TZ"]).toBe(before);
  });
});
