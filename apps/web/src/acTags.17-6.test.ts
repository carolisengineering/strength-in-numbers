import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-6.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.6 AC26: AC1–AC19 and AC21–AC24. AC20 is the screenshot harness ("record ledger summaries", and capture 13's
 * first-screen check), AC25 the docs, AC27 the phone check. Only numbers written as "17.6 ACn" (or "17.6 ACn / ACm")
 * count; a title that also cites another spec's criteria does not tag 17.6's.
 */
const WANTED = [...Array.from({ length: 19 }, (_, i) => i + 1), 21, 22, 23, 24];

describe("17.6 AC26 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.6 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.6 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
