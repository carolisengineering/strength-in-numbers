import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.18-2.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 18.2 AC30 (Phase A; Phase B appends AC56's list). The criteria with a unit test (§10); this file is AC30's
 * own test, AC27 is the harness, AC28 the e2e, AC29 CI and AC31 manual. Only numbers written as "18.2 ACn" (or
 * "18.2 ACn / ACm") in a describe title count.
 */
const WANTED = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  // Phase B: AC56 is this test too, AC55 the harness, AC58 manual.
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 57,
];

describe("18.2 AC30 / AC56 — every unit-tested criterion has a tagged test", () => {
  it("each wanted AC appears in a describe title as '18.2 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const group of title[2]!.matchAll(/18\.2 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
