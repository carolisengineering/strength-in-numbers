import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-6.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.6 AC26, Phase A's part: AC1–AC19. AC20 is the screenshot harness ("record ledger summaries"), AC25 the docs,
 * AC27 the phone check; Phase B adds AC21–AC24. Only numbers written as "17.6 ACn" (or "17.6 ACn / ACm") count; a title
 * that also cites another spec's criteria does not tag 17.6's.
 */
const WANTED = Array.from({ length: 19 }, (_, i) => i + 1);

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
