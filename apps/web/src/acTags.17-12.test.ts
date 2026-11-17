import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-12.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/**
 * Spec 17.12 AC33: Phase A tags AC1–AC10. AC11 and AC12 are harness checks (`capture.mjs`'s `desktopPass`), and so is
 * AC31's 200% text; Phases B–D extend this list with AC13–AC30. Only numbers written as "17.12 ACn" (or "17.12 ACn,
 * ACm") count.
 */
const WANTED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("17.12 AC33 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.12 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.12 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
