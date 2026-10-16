import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.06-5.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("06.5 AC27 — every behavioral criterion has a committed, tagged test", () => {
  // AC26 is the CI gate (coverage thresholds) plus review of the doc diffs; AC27 is this scan.
  it("AC1–AC25 each appear in a describe title that names 06.5", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*06\.5[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const missing = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !tagged.has(n));
    expect(missing).toEqual([]);
  });
});
