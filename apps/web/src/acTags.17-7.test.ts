import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-7.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.7 AC26, Phase A's part: AC1 and AC3–AC11. AC2 is the screenshot harness's `segments` check (jsdom has no
 * layout). Phase B extends WANTED with AC12–AC24. Only numbers written as "17.7 ACn" (or "17.7 ACn, ACm") in a describe
 * title count; a title that cites another spec's criteria does not tag 17.7's.
 */
const WANTED = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11];

describe("17.7 AC26 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.7 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.7 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
