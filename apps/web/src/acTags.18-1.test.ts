import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.18-1.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 18.1 AC38. The Phase A criteria with a unit test (§10): AC1–AC24 and AC40. AC25 is the screens harness, AC36 the
 * CSS-token check, AC37 the whole suite, AC39 manual; Phase B appends AC26–AC34. Only numbers written as "18.1 ACn"
 * (or "18.1 ACn / ACm") in a describe title count.
 */
const WANTED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 40];

describe("18.1 AC38 — every unit-tested criterion has a tagged test", () => {
  it("each wanted AC appears in a describe title as '18.1 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const group of title[2]!.matchAll(/18\.1 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
