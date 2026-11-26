import { describe, expect, it } from "vitest";

// Raw source of every non-test module under src, outside src/test/ (the pattern in workouts/hygiene.test.ts).
const sources = import.meta.glob(
  ["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../test/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const offenders = (pattern: RegExp) =>
  Object.entries(sources)
    .filter(([, source]) => pattern.test(source))
    .map(([path]) => path)
    .sort();

/**
 * A date built outside ui/dateText.ts (minor 529): any `Intl.DateTimeFormat(` but a zone-only
 * `Intl.DateTimeFormat().resolvedOptions(`, `toLocaleDateString` / `toLocaleTimeString`, any `toLocaleString(`, and a
 * hand-written month table. Minor 752: a pinned `("en-US")` is no exemption by itself, since a date can pin it too; the
 * Hevy screens' number files are listed by path below, and their calls are checked to be counts.
 */
const DATE_BUILDERS = /Intl\.DateTimeFormat\((?!\)\.resolvedOptions\()|toLocale(?:Date|Time)String|toLocaleString\(|["']Jan["']\s*,\s*["']Feb["']/;
/** The Hevy screens' number files: they call `toLocaleString("en-US")` for counts only (checked below). */
const HEVY_NUMBER_FILES = [
  "../features/hevy/import/ImportSummaryView.tsx",
  "../features/hevy/import/importNeeds.ts",
  "../features/hevy/import/messages.ts",
  "../features/hevy/send/messages.ts",
];
/** A number file with its exact count calls taken out: any date builder left is a date. */
const withoutCounts = (source: string) => source.replaceAll('toLocaleString("en-US")', "");

describe("17.13 AC1 — one module", () => {
  it("found the sources it is meant to scan", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(200);
    expect(sources["./dateText.ts"]).toBeDefined();
    expect(Object.keys(sources).some((path) => path.startsWith("../test/"))).toBe(false);
  });

  it("no module names the British locale", () => {
    expect(offenders(/en-GB/)).toEqual([]);
  });

  it("the date module never forces an hour cycle", () => {
    expect(sources["./dateText.ts"]).not.toMatch(/hourCycle|hour12/);
  });

  it("dates are built only in ui/dateText.ts and the Hevy import's month-year helper (and the Hevy number files' counts)", () => {
    expect(offenders(DATE_BUILDERS)).toEqual(
      [...HEVY_NUMBER_FILES, "../features/hevy/import/RunStep.tsx", "./dateText.ts"].sort(),
    );
  });

  it("minor 752: the Hevy number files call toLocaleString only as a count: exactly (\"en-US\")", () => {
    for (const path of HEVY_NUMBER_FILES) {
      expect(sources[path], path).toBeDefined();
      expect(withoutCounts(sources[path]!), path).not.toMatch(DATE_BUILDERS);
    }
    for (const sample of ['n.toLocaleString("en-US", { month: "short" })', 'n.toLocaleString("en-US"); d.toLocaleDateString()']) {
      expect(withoutCounts(sample), sample).toMatch(DATE_BUILDERS);
    }
  });

  it("minor 529: the pattern catches an empty-argument format, toLocaleString and a hand-written month table", () => {
    for (const sample of ["new Intl.DateTimeFormat().format(d)", "d.toLocaleString()", 'const M = ["Jan", "Feb"]']) {
      expect(sample, sample).toMatch(DATE_BUILDERS);
    }
  });

  it("minor 752: a date that pins en-US is a date builder", () => {
    expect('new Date(x).toLocaleString("en-US", { month: "short" })').toMatch(DATE_BUILDERS);
  });
});
