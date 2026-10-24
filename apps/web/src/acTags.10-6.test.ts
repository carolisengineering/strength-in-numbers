import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-6.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Phase A's criteria: AC17–AC21 are Phase B's (the edit screen), which extends this list to AC1–AC27. */
const PHASE_A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 22, 23, 24, 25, 26, 27];

describe("10.6 AC30 — every behavioral criterion has a committed, tagged test", () => {
  // AC28 is the screenshot harness, AC29 the owner's phone check in the PR description, AC30 this scan plus review —
  // none is a unit test. This checks tags, not how well a tagged test covers its AC.
  it("each Phase A criterion appears in a describe title that names Spec 10.6", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.6[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    expect(PHASE_A.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
