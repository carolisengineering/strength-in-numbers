import { describe, expect, it } from "vitest";
import { CodeCounter, cleanLine, cleanNotes, cutCodePoints, importTimes } from "../src/hevy/importText.js";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const times = (startTime: string, endTime: string, tzOffsetMinutes = 0) => importTimes({ startTime, endTime, tzOffsetMinutes }, NOW);

describe("19.1 AC2 — times", () => {
  it("an end before the start is invalid", () => {
    expect(times("2026-10-01T11:00:00Z", "2026-10-01T10:59:59Z")).toEqual({ ok: false });
  });

  it("an end equal to the start is valid", () => {
    expect(times("2026-10-01T11:00:00Z", "2026-10-01T11:00:00Z").ok).toBe(true);
  });

  it("a start before 2000-01-01T00:00:00Z is invalid; exactly then is valid", () => {
    expect(times("1999-12-31T23:59:59Z", "2000-01-01T01:00:00Z")).toEqual({ ok: false });
    expect(times("2000-01-01T00:00:00Z", "2000-01-01T01:00:00Z").ok).toBe(true);
  });

  it("an end up to 5 minutes after now is valid; one millisecond more is not", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(times("2026-10-28T11:00:00Z", at(300_000)).ok).toBe(true);
    expect(times("2026-10-28T11:00:00Z", at(300_001))).toEqual({ ok: false });
  });

  it("an unparsable time is invalid", () => {
    expect(times("not a time", "2026-10-01T11:00:00Z")).toEqual({ ok: false });
    expect(times("2026-10-01T11:00:00Z", "")).toEqual({ ok: false });
  });

  it("localDate comes from the start and the request offset; the instants are kept", () => {
    expect(times("2026-10-01T03:30:00Z", "2026-10-01T04:30:00+00:00", -300)).toEqual({
      ok: true,
      startedAt: "2026-10-01T03:30:00.000Z",
      endedAt: "2026-10-01T04:30:00.000Z",
      localDate: "2026-09-30",
    });
  });

  it("an offset in the instant is the same instant", () => {
    const r = times("2026-10-01T12:00:00+02:00", "2026-10-01T13:00:00+02:00", 120);
    expect(r).toEqual({ ok: true, startedAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T11:00:00.000Z", localDate: "2026-10-01" });
  });
});

describe("19.1 AC8 — text", () => {
  it("cleanLine removes control characters and trims", () => {
    expect(cleanLine("  Push\u0007 Day ", 120)).toEqual({ value: "Push Day", cut: false });
  });

  it("a line of only spaces or control characters is null, not a cut", () => {
    expect(cleanLine(" \u0001 ", 120)).toEqual({ value: null, cut: false });
    expect(cleanLine("\t\n ", 120)).toEqual({ value: null, cut: false });
    expect(cleanLine(null, 120)).toEqual({ value: null, cut: false });
  });

  it("a 121-character title is cut to 120", () => {
    const r = cleanLine("a".repeat(121), 120);
    expect(r.cut).toBe(true);
    expect(r.value).toHaveLength(120);
  });

  it("a line exactly at the limit after trimming is not a cut", () => {
    expect(cleanLine(`  ${"a".repeat(120)}  `, 120)).toEqual({ value: "a".repeat(120), cut: false });
  });

  it("a cut never leaves half a surrogate pair", () => {
    const r = cleanLine(`${"a".repeat(119)}😀`, 120);
    expect(r).toEqual({ value: "a".repeat(119), cut: true });
    expect(/[\uD800-\uDFFF]$/.test(r.value!)).toBe(false);
  });

  it("cleanNotes keeps TAB, LF and CR and removes other control characters", () => {
    expect(cleanNotes("a\tb\nc\u0000", 4000)).toEqual({ value: "a\tb\nc", cut: false });
    expect(cleanNotes("a\r\nb\u007f", 4000)).toEqual({ value: "a\r\nb", cut: false });
  });

  it("cleanNotes trims only the ends, and empty is null", () => {
    expect(cleanNotes("  a\n\n  b  ", 4000)).toEqual({ value: "a\n\n  b", cut: false });
    expect(cleanNotes(" \n\t ", 4000)).toEqual({ value: null, cut: false });
  });

  it("cleanNotes cuts to the limit", () => {
    expect(cleanNotes("n".repeat(4001), 4000)).toEqual({ value: "n".repeat(4000), cut: true });
  });

  describe("Minor 209 — titles and notes keep clusters whole", () => {
    const a = (n: number) => "a".repeat(n);
    it("a title cut inside a ZWJ sequence drops the whole sequence", () =>
      expect(cleanLine(`${a(118)}👩‍💻`, 120)).toEqual({ value: a(118), cut: true }));
    it("a title cut between a flag's two halves drops the flag", () =>
      expect(cleanLine(`${a(118)}🇺🇸`, 120)).toEqual({ value: a(118), cut: true }));
    it("a note cut before a combining mark drops its letter too", () =>
      expect(cleanNotes(`${"n".repeat(4000)}́`, 4000)).toEqual({ value: "n".repeat(3999), cut: true }));
    it("a title that is one cluster longer than the limit is null, never an empty string, and not a cut (minors 276, 289)", () => {
      expect(cleanLine(`H${"\u0301".repeat(130)}`, 120)).toEqual({ value: null, cut: false });
      expect(cleanNotes(`H${"\u0301".repeat(4001)}`, 4000)).toEqual({ value: null, cut: false });
    });
  });

  it("cutCodePoints trims the end it leaves", () => {
    expect(cutCodePoints("abc def", 4)).toEqual({ text: "abc", cut: true });
    expect(cutCodePoints("abc", 4)).toEqual({ text: "abc", cut: false });
  });

  it("the counter lists codes in declared order and omits zeros", () => {
    const c = new CodeCounter(["a", "b", "c"] as const);
    c.add("c");
    c.add("a", 3);
    c.add("c", 2);
    c.add("b", 0);
    expect(c.list()).toEqual([
      { code: "a", count: 3 },
      { code: "c", count: 3 },
    ]);
  });
});
