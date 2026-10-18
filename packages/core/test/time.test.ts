import { describe, expect, it } from "vitest";
import { clampInstantToSpan, localDateFor, offsetMinutesForZone } from "../src/time.js";

describe("AC19/AC6 — time.ts", () => {
  describe("localDateFor", () => {
    it("east-of-UTC positive offset can move the date forward across midnight", () => {
      // 23:30Z + 120 min (UTC+02:00, east) = 01:30 local the next day
      expect(localDateFor("2026-03-14T23:30:00.000Z", 120)).toBe("2026-03-15");
    });

    it("west-of-UTC negative offset keeps the same day for the same instant", () => {
      // 23:30Z - 360 min (UTC-06:00, west) = 17:30 local, same day
      expect(localDateFor("2026-03-14T23:30:00.000Z", -360)).toBe("2026-03-14");
    });

    it("zero offset returns the UTC calendar date unchanged", () => {
      expect(localDateFor("2026-06-01T00:00:00.000Z", 0)).toBe("2026-06-01");
    });
  });

  describe("offsetMinutesForZone", () => {
    it("returns the east-positive offset at the given instant (DST transition)", () => {
      // America/New_York: EST (UTC-05:00) before the 2026 spring-forward,
      // EDT (UTC-04:00) after. Spring-forward 2026-03-08 07:00 UTC.
      expect(offsetMinutesForZone("2026-03-08T06:00:00.000Z", "America/New_York")).toBe(
        -300,
      );
      expect(offsetMinutesForZone("2026-03-08T08:00:00.000Z", "America/New_York")).toBe(
        -240,
      );
    });

    it("returns a positive value for an east-of-UTC zone", () => {
      expect(offsetMinutesForZone("2026-06-01T00:00:00.000Z", "Europe/Paris")).toBe(120);
    });

    it("returns 0 for UTC (bare GMT parses as 0)", () => {
      expect(offsetMinutesForZone("2026-06-01T00:00:00.000Z", "UTC")).toBe(0);
    });
  });
});

describe("07.4 — clampInstantToSpan", () => {
  const start = new Date("2026-10-16T18:00:00.000Z");
  const end = new Date("2026-10-16T19:00:00.000Z");
  it("pulls an instant before the start up to the start", () => {
    expect(clampInstantToSpan(new Date("2026-10-16T17:00:00.000Z"), start, end)).toEqual(start);
  });
  it("pulls an instant after the end down to the end", () => {
    expect(clampInstantToSpan(new Date("2026-10-18T09:00:00.000Z"), start, end)).toEqual(end);
  });
  it("keeps an instant inside the span", () => {
    const inside = new Date("2026-10-16T18:30:00.000Z");
    expect(clampInstantToSpan(inside, start, end)).toEqual(inside);
  });
  it("a zero-length span returns that instant", () => {
    expect(clampInstantToSpan(new Date("2026-10-18T09:00:00.000Z"), start, start)).toEqual(start);
  });
});
