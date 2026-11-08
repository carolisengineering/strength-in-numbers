import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-4.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.4 AC20 (AC1-AC16, AC18; AC17 and AC21 are the screenshot harness, AC19 the docs, AC22 the phone check). Only
 * numbers written as "17.4 ACn" (or "17.4 ACn, ACm") count; a title that also cites another spec's criteria does not tag 17.4's.
 */
const WANTED = [...Array.from({ length: 16 }, (_, i) => i + 1), 18];

describe("17.4 AC20 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.4 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.4 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
