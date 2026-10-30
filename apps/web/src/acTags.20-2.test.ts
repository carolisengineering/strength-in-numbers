import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.20-2.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("20.2 AC21 — every Phase A criterion has a committed, tagged test", () => {
  // AC21 is the harness and CI (with its structural a11y test); AC22 is the live check against Hevy (gym checklist).
  // Phase B adds AC23–AC30.
  it("AC1–AC20 each appear in a describe title that names Spec 20.2", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])(20\.2 AC[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
