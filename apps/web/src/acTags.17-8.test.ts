import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-8.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.8 AC22, Phase A's part: AC3–AC9. AC1, AC2, AC10 and AC20 are the screenshot harness's measurements (AC1 and
 * AC10 also have source scans), AC19 is the unchanged suites, AC23 the captures. Phase B adds AC11–AC18. Only numbers
 * written as "17.8 ACn" (or "17.8 ACn, ACm") count; a title that also cites another spec's criteria does not tag 17.8's.
 */
const WANTED = [3, 4, 5, 6, 7, 8, 9];

describe("17.8 AC22 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.8 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.8 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
