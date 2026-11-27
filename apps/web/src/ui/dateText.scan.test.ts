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
 * hand-written month table. Minor 752: a pinned `("en-US")` is no exemption by itself, since a date can pin it too.
 * Minor 780: the Hevy screens' counts go through one helper, the only exemption, which holds that one call.
 */
const DATE_BUILDERS = /Intl\.DateTimeFormat\((?!\)\.resolvedOptions\()|toLocale(?:Date|Time)String|toLocaleString\(|["']Jan["']\s*,\s*["']Feb["']/;
/** The Hevy screens' count helper: `n.toLocaleString("en-US")` and nothing else (checked below). */
const HEVY_COUNT_FILE = "../features/hevy/formatCount.ts";

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

  it("dates are built only in ui/dateText.ts and the Hevy import's month-year helper (and the Hevy count helper)", () => {
    expect(offenders(DATE_BUILDERS)).toEqual([HEVY_COUNT_FILE, "../features/hevy/import/RunStep.tsx", "./dateText.ts"].sort());
  });

  it("minor 780: the count helper holds one toLocaleString, and it is the count", () => {
    const source = sources[HEVY_COUNT_FILE];
    expect(source).toBeDefined();
    expect(source!.match(/toLocaleString\(/g)).toHaveLength(1);
    expect(source).toContain('n.toLocaleString("en-US")');
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
