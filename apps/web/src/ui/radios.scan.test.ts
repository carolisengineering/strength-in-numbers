import { describe, expect, it } from "vitest";

// Raw source of every non-test module under src.
const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../test/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("17.13 AC16 — radios have two looks", () => {
  it("found the sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(200);
  });

  it("a native radio is rendered only by RadioChip and Segmented", () => {
    // A CSS selector string such as input[type="radio"] is a query, not a radio: the lookahead skips `"]`.
    const owners = Object.entries(sources)
      .filter(([, source]) => /type[:=]\s*["']radio["'](?!\])/.test(source))
      .map(([path]) => path)
      .sort();
    expect(owners).toEqual(["./RadioChip.tsx", "./Segmented.tsx"]);
  });
});
