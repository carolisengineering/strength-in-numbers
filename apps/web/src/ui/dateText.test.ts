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
        expect(timeText(date, UTC)).not.toContain("\u202f");
        expect(momentText(date, UTC)).not.toContain("\u202f");
        expect(timeText(date)).not.toContain("\u202f");
      }
    });
  });

  it("an ICU that puts U+202F before PM (Safari, some ICU builds) still gives a plain space", () => {
    // The repo's Node already prints a plain space, so simulate the ICU that doesn't. `format` is an
    // accessor at run time, though its type says method.
    const proto = Intl.DateTimeFormat.prototype as unknown as { format: unknown };
    const spy = vi
      .spyOn(proto, "format", "get")
      .mockReturnValue(() => "Wed, Nov 4, 11:10\u202fPM");
    try {
      expect(timeText(INSTANT)).toBe("Wed, Nov 4, 11:10 PM");
      expect(momentText(INSTANT, UTC)).toBe("Wed, Nov 4, 11:10 PM");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("17.13 final review M1 — an empty zone means the device zone", () => {
  it("every formatter treats \"\" as no zone, as the code before the move did", () => {
    inTimeZone("Asia/Tokyo", () => {
      expect(timeText(INSTANT, { timeZone: "" })).toBe(timeText(INSTANT));
      expect(dayText(INSTANT, { timeZone: "" })).toBe(dayText(INSTANT));
      expect(longDayText(INSTANT, { timeZone: "" })).toBe(longDayText(INSTANT));
    });
  });
});

// Code review: every "show the year?" decision in the app compares Gregorian years, so every form is Gregorian.
describe("17.13 code review — every form uses the Gregorian calendar", () => {
  it("a Buddhist-calendar locale shows 2026, not 2569, on a day, a long day and a stored date", () => {
    withLocale("th-TH", () => {
      expect(dayText(INSTANT, { ...UTC, year: true })).toContain("2026");
      expect(longDayText(INSTANT, UTC)).toContain("2026");
      expect(monthDayText("2026-11-04", { withYear: true })).toContain("2026");
      expect(dayText(INSTANT, { ...UTC, year: true })).not.toContain("2569");
    });
  });
});

describe("17.13 code review — the formatter cache keys on the options", () => {
  it("a day with and without the year never share a cached formatter", () => {
    withLocale("en-US", () => {
      expect(dayText(INSTANT, UTC)).toBe("Wed, Nov 4");
      expect(dayText(INSTANT, { ...UTC, year: true })).toBe("Wed, Nov 4, 2026");
      expect(dayText(INSTANT, UTC)).toBe("Wed, Nov 4");
    });
  });
});

// M4: the chart's ticks sit on Gregorian month starts, so their names are Gregorian months in every locale.
describe("17.13 final review M4 — month ticks are Gregorian months", () => {
  it("a locale whose default calendar is another one still names the Gregorian month", () => {
    withLocale("fa-IR", () => {
      const gregorian = new Intl.DateTimeFormat("fa-IR", { month: "short", calendar: "gregory", timeZone: "UTC" }).format(new Date(Date.UTC(2025, 11, 1)));
      expect(monthText(2025, 12)).toBe(gregorian);
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
