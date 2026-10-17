import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.17-1.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 17.1 AC56, Phase B's share. Only numbers written as "17.1 ACn" (or "17.1 ACn / ACm") count, so a title that
 * also cites another spec's criteria ("17.1 AC34 (06.2 AC14)") does not tag 17.1 AC14.
 * Untagged by design: AC6 (CI path check), AC8 (docs review); AC55–AC59 are review, CI or manual (§10).
 */
const WANTED = [1, 2, 3, 4, 5, 7, ...Array.from({ length: 46 }, (_, i) => i + 9)];

describe("17.1 AC56 — every behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '17.1 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const group of title[2]!.matchAll(/17\.1 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
