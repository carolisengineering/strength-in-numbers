import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.20-0.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("20.0 AC32 — every Phase A criterion has a committed, tagged test", () => {
  // AC13 (the CSP) is pinned in apps/api's assert-firebase-json and web-smoke-checks tests; AC33 is the owner's phone
  // check. Phase B extends the list.
  it("AC1–AC12 and AC14–AC16 each appear in a describe title that names Spec 20.0", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])(20\.0 AC[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16];
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
