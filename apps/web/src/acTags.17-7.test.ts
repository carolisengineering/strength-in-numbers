import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-7.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.7 AC26: AC1, AC3–AC21, AC23 and AC24. The rest are not unit tests: AC2 and AC22 are the screenshot harness
 * (its `segments` and `cardDeclutter` checks; jsdom has no layout; AC16 is also measured there, beside its unit test),
 * AC25 is the docs, AC26 is this scan, and AC27–AC28 are the shots and the phone check. Only numbers written as
 * "17.7 ACn" (or "17.7 ACn, ACm") in a describe title count; a title that cites another spec's criteria does not tag 17.7's.
 */
const WANTED = [1, ...Array.from({ length: 19 }, (_, k) => k + 3), 23, 24];

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
