import { afterEach, describe, expect, it, vi } from "vitest";

import { pinLocale, withLocale } from "../test/locale";
import { inTimeZone } from "../test/timeZone";
import {
  appLocale,
  dayText,
  deviceLocale,
  longDayText,
  momentText,
  monthDayText,
  monthText,
  setLocaleForTests,
  timeText,
} from "./dateText";

const INSTANT = new Date("2026-11-04T23:10:00Z");
const MIDNIGHT = new Date("2026-11-04T00:05:00Z");
const NOON = new Date("2026-11-04T12:00:00Z");
const UTC = { timeZone: "UTC" };

describe("17.13 AC2 — the forms follow the locale", () => {
  it("en-US: weekday, month, day; 12-hour times", () => {
    withLocale("en-US", () => {
      expect(dayText(INSTANT, UTC)).toBe("Wed, Nov 4");
      expect(dayText(INSTANT, { ...UTC, year: true })).toBe("Wed, Nov 4, 2026");
      expect(timeText(INSTANT, UTC)).toBe("11:10 PM");
      expect(momentText(INSTANT, UTC)).toBe("Wed, Nov 4, 11:10 PM");
      expect(timeText(MIDNIGHT, UTC)).toBe("12:05 AM");
      expect(timeText(NOON, UTC)).toBe("12:00 PM");
    });
  });

  it("en-GB: day before month; 24-hour times", () => {
    withLocale("en-GB", () => {
      expect(dayText(INSTANT, UTC)).toBe("Wed 4 Nov");
      expect(dayText(INSTANT, { ...UTC, year: true })).toBe("Wed, 4 Nov 2026");
      expect(timeText(INSTANT, UTC)).toBe("23:10");
      expect(momentText(INSTANT, UTC)).toBe("Wed 4 Nov, 23:10");
      // `hour: "numeric"` (the one option set, AC2) gives en-GB "0:05", not "00:05".
      expect(timeText(MIDNIGHT, UTC)).toBe("0:05");
    });
  });

  it("de-DE: the locale's own punctuation", () => {
    withLocale("de-DE", () => {
      expect(dayText(INSTANT, UTC)).toBe("Mi., 4. Nov.");
      expect(timeText(INSTANT, UTC)).toBe("23:10");
    });
  });

  it("en-US: stored dates, months and the long day", () => {
    withLocale("en-US", () => {
      expect(monthDayText("2026-10-06")).toBe("Oct 6");
      expect(monthText(2025, 12, { withYear: true })).toBe("Dec 2025");
      expect(monthText(2026, 8)).toBe("Aug");
      expect(longDayText(INSTANT, UTC)).toBe("November 4, 2026");
    });
  });
});

describe("17.13 AC3 — the fallback is en-US", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLocaleForTests("en-US");
  });

  function stubLocale(read: () => string): void {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () => ({ resolvedOptions: () => ({ locale: read() }) }) as unknown as Intl.DateTimeFormat,
    );
  }

  it("a lookup that throws", () => {
    stubLocale(() => {
      throw new Error("no ICU");
    });
    setLocaleForTests(null);
    expect(deviceLocale()).toBe("en-US");
  });

  it("an empty locale", () => {
    stubLocale(() => "");
    setLocaleForTests(null);
    expect(deviceLocale()).toBe("en-US");
  });

  it("the undetermined locale", () => {
    stubLocale(() => "und");
    setLocaleForTests(null);
    expect(deviceLocale()).toBe("en-US");
  });

  it("a usable locale is kept", () => {
    stubLocale(() => "fr-CA");
    setLocaleForTests(null);
    expect(deviceLocale()).toBe("fr-CA");
  });
});

describe("17.13 AC4 — plain spaces", () => {
  it("no narrow no-break space in a time or a moment", () => {
    withLocale("en-US", () => {
      for (const date of [INSTANT, MIDNIGHT, NOON]) {
        expect(timeText(date, UTC)).not.toContain(" ");
        expect(momentText(date, UTC)).not.toContain(" ");
        expect(timeText(date)).not.toContain(" ");
      }
    });
  });
});

describe("17.13 AC4a — calendar days are stable", () => {
  it.each(["Pacific/Auckland", "Pacific/Pago_Pago"])("a UTC day is the same day in %s", (zone) => {
    const day = new Date("2026-11-04T00:00:00Z");
    expect(inTimeZone(zone, () => dayText(day, UTC))).toBe("Wed, Nov 4");
    expect(inTimeZone(zone, () => monthDayText("2026-11-04"))).toBe("Nov 4");
  });

  it("device-zone formatters follow a zone change while the page is open", () => {
    const chicago = inTimeZone("America/Chicago", () => timeText(INSTANT));
    const tokyo = inTimeZone("Asia/Tokyo", () => timeText(INSTANT));
    expect(chicago).toBe("5:10 PM");
    expect(tokyo).toBe("8:10 AM");
  });
});

describe("17.13 AC6 — the suite is pinned to en-US", () => {
  it("every test file starts in en-US", () => {
    expect(appLocale()).toBe("en-US");
  });

  describe("a nested pin", () => {
    pinLocale("en-GB");
    it("applies inside", () => {
      expect(appLocale()).toBe("en-GB");
      expect(dayText(INSTANT, UTC)).toBe("Wed 4 Nov");
    });
  });

  it("is restored afterward", () => {
    expect(appLocale()).toBe("en-US");
    expect(dayText(INSTANT, UTC)).toBe("Wed, Nov 4");
  });
});
