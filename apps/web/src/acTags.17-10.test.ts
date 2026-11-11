import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-10.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.10 AC21 (AC1-AC18; AC19 is the screenshot harness, AC20 the
 * docs, AC22 the phone check). Only numbers written as "17.10 ACn" (or "17.10 ACn, ACm") count.
 */
const WANTED = Array.from({ length: 18 }, (_, i) => i + 1);

describe("17.10 AC21 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.10 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.10 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
