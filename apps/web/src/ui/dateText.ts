/**
 * Spec 17.13 Phase A (D1): every lifter-visible date and time is formatted here, in the locale the
 * browser reports, falling back to en-US. The locale decides the order, the punctuation and the
 * clock; the app never forces an hour cycle. Stored calendar days (`localDate`) format in UTC, so
 * they are the same day in every zone; moments follow the device zone.
 */

const FALLBACK_LOCALE = "en-US";

/** The browser's locale, or en-US when the lookup throws or finds nothing usable (AC3). */
export function deviceLocale(): string {
  try {
    const found = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (found && found !== "und") return found;
  } catch {
    /* fall through to the fallback */
  }
  return FALLBACK_LOCALE;
}

let locale: string | null = null;
// One formatter per option set and zone, built only when the zone is explicit: a formatter built
// with no `timeZone` keeps the zone it was built in, so device-zone formatters are made per call.
const cache = new Map<string, Intl.DateTimeFormat>();

/** The locale the app formats in, read from the device once per page load. */
export function appLocale(): string {
  locale ??= deviceLocale();
  return locale;
}

/** Tests only: pin the locale (`null` reads the device again) and drop every cached formatter. */
export function setLocaleForTests(next: string | null): void {
  locale = next;
  cache.clear();
}

type Zone = { timeZone?: string };

const DAY: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const DAY_KEY: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };

function formatter(name: string, options: Intl.DateTimeFormatOptions, timeZone?: string, keyLocale?: string): Intl.DateTimeFormat {
  const loc = keyLocale ?? appLocale();
  // An empty zone is no zone, as `timeZone ? { timeZone } : {}` treated it before this module (final review M1).
  if (!timeZone) return new Intl.DateTimeFormat(loc, options);
  const key = `${loc}|${name}|${timeZone}`;
  let found = cache.get(key);
  if (!found) {
    // A zone the host doesn't know throws here, before anything is cached.
    found = new Intl.DateTimeFormat(loc, { ...options, timeZone });
    cache.set(key, found);
  }
  return found;
}

// AC4: modern ICU puts a narrow no-break space before AM / PM; the app shows a plain one.
const plain = (text: string): string => text.replace(/\u202f/g, " ");

/** A day: en-US "Wed, Nov 4"; with `year`, "Wed, Nov 4, 2026". */
export function dayText(date: Date, { timeZone, year = false }: Zone & { year?: boolean } = {}): string {
  const options = year ? { ...DAY, year: "numeric" as const } : DAY;
  return plain(formatter(year ? "dayYear" : "day", options, timeZone).format(date));
}

/** A time: en-US "5:10 PM"; a 24-hour locale "17:10". */
export function timeText(date: Date, { timeZone }: Zone = {}): string {
  return plain(formatter("time", TIME, timeZone).format(date));
}

/** A day and a time in one formatter, so the locale chooses the separator: en-US "Wed, Nov 4, 5:10 PM". */
export function momentText(date: Date, { timeZone }: Zone = {}): string {
  return plain(formatter("moment", { ...DAY, ...TIME }, timeZone).format(date));
}

/** A long day: en-US "November 4, 2026". */
export function longDayText(date: Date, { timeZone }: Zone = {}): string {
  return plain(formatter("long", { dateStyle: "long" }, timeZone).format(date));
}

/** A stored `localDate` with no weekday: en-US "Oct 6"; with `withYear`, "Oct 6, 2026". */
export function monthDayText(localDate: string, { withYear = false }: { withYear?: boolean } = {}): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) };
  return plain(formatter(withYear ? "monthDayYear" : "monthDay", options, "UTC").format(new Date(`${localDate}T00:00:00Z`)));
}

/** A month (1–12): en-US "Aug"; with `withYear`, "Dec 2025". */
export function monthText(year: number, month: number, { withYear = false }: { withYear?: boolean } = {}): string {
  // The chart puts this on a Gregorian month start, so it names the Gregorian month even where the locale's default
  // calendar is another one (fa-IR's is Persian; final review M4).
  const options: Intl.DateTimeFormatOptions = { month: "short", calendar: "gregory", ...(withYear ? { year: "numeric" } : {}) };
  return plain(formatter(withYear ? "monthYear" : "month", options, "UTC").format(new Date(Date.UTC(year, month - 1, 1))));
}

/** Whether two instants fall on one calendar day in the zone. Compares en-CA keys, never shown text. */
export function isSameDay(a: Date, b: Date, { timeZone }: Zone = {}): boolean {
  const key = formatter("dayKey", DAY_KEY, timeZone, "en-CA");
  return key.format(a) === key.format(b);
}

/** `"2026-10-06"` → en-US `"Tue, Oct 6"`: a stored calendar day, in UTC so it never shifts (Spec 08.0 AC11, 17.13 AC4a). */
export function formatLocalDate(localDate: string): string {
  return dayText(new Date(`${localDate}T00:00:00Z`), { timeZone: "UTC" });
}

/** A start's time: en-US "6:05 PM". `timeZone` exists so tests are machine-independent. */
export function formatStartedTime(iso: string, { timeZone }: Zone = {}): string {
  return timeText(new Date(iso), { timeZone });
}

/**
 * Spec 18.0 AC3: a start as en-US `"Wed, Oct 14, 6:05 PM"` in the device zone. Unlike `formatLocalDate` this is a
 * moment, so it follows the zone, not the stored `localDate`. AC34: a start on `today`'s calendar day (in the same
 * zone) is the time alone.
 */
export function formatStartedAt(iso: string, { timeZone, today }: Zone & { today?: Date } = {}): string {
  const date = new Date(iso);
  if (today && isSameDay(date, today, { timeZone })) return timeText(date, { timeZone });
  return momentText(date, { timeZone });
}
