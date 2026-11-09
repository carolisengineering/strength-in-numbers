import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-5.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.5 AC24 (AC1-AC22; AC23 is the docs, AC25 the harness, AC26 the phone check). Only numbers written as "17.5 ACn"
 * (or "17.5 ACn, ACm") count; a title that also cites another spec's criteria does not tag 17.5's.
 */
const WANTED = Array.from({ length: 22 }, (_, i) => i + 1);

describe("17.5 AC24 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.5 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.5 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
