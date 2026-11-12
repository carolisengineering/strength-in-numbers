import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-11.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/**
 * Spec 17.11 AC23, Phase A: AC1 and AC3–AC10. AC2 and AC10's box are harness measurements (`capture.mjs`'s
 * `exercisePage`), AC22 the docs, AC24 the screenshots and AC25 the phone check. Phase B adds AC11–AC21 here. Only
 * numbers written as "17.11 ACn" (or "17.11 ACn, ACm") count.
 */
const WANTED = [1, 3, 4, 5, 6, 7, 8, 9, 10];

describe("17.11 AC23 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.11 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.11 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
