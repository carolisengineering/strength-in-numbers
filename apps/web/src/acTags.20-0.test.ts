import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.20-0.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("20.0 AC32 — every criterion has a committed, tagged test", () => {
  // AC13 (the CSP) is pinned in apps/api's assert-firebase-json and web-smoke-checks tests; AC33 is the owner's phone
  // check. Phase B extends the list.
  it("AC1–AC12 and AC14–AC31 each appear in a describe title that names Spec 20.0", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])(20\.0 AC[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    // Phase A: AC1–AC12, AC14–AC16; Phase B: AC17–AC31. AC13 is pinned in apps/api; AC33 is the phone check.
    const wanted = Array.from({ length: 31 }, (_, i) => i + 1).filter((n) => n !== 13);
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
