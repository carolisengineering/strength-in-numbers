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

  it("dates are built only in ui/dateText.ts and the Hevy import's month-year helper", () => {
    // The lookahead leaves zone-only reads such as `Intl.DateTimeFormat().resolvedOptions()` alone.
    expect(offenders(/Intl\.DateTimeFormat\((?!\))|toLocale(Date|Time)String/)).toEqual([
      "../features/hevy/import/RunStep.tsx",
      "./dateText.ts",
    ]);
  });
});
