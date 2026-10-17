import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-3.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.3 AC34. The criteria with a unit test (§10); the rest are harness, CI-pipeline, review or manual (AC18, AC19,
 * AC21-AC24, AC27, AC30-AC33, AC35, AC36). Only numbers written as "17.3 ACn" (or "17.3 ACn / ACm") count.
 */
const WANTED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 25, 26, 28, 29];

describe("17.3 AC34 — every unit-tested criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.3 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.3 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
