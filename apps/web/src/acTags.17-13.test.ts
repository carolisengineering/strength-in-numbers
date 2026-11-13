import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-13.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.13 AC23, Phase A (AC1-AC7 with AC4a; AC4b is the screenshot harness). Phases B and C extend the list. Only
 * numbers written as "17.13 ACn" (or "17.13 ACn, ACm") count; a title that also cites another spec's criteria does not
 * tag 17.13's.
 */
const WANTED = ["1", "2", "3", "4", "4a", "5", "6", "7"];

describe("17.13 AC23 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.13 ACn'", () => {
    const tagged = new Set<string>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.13 ((?:AC\d+[a-z]?(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+[a-z]?)/g)) tagged.add(ac[1]!);
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
