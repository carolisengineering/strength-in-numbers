import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-2.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.2 AC38 (AC1-AC36; AC37 is the contrast table, a CI pair check). Only numbers written as "17.2 ACn" (or "17.2 ACn / ACm") count; a title that
 * also cites another spec's criteria does not tag 17.2's.
 */
// Spec 17.6 retires AC15, AC17–AC20, AC26 and AC27 (the cards, chips and "N new" became the ledger and a count of lifts).
const RETIRED_BY_17_6 = [15, 17, 18, 19, 20, 26, 27];
const WANTED = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !RETIRED_BY_17_6.includes(n));

describe("17.2 AC38 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.2 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.2 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
