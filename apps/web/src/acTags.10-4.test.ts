import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-4.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("10.4 AC41 — every web criterion has a committed, tagged test", () => {
  // AC1–AC18 are core's (packages/core/test/acTags.10-4.test.ts); AC38 is the CI gate and the diff-scope check,
  // AC39 the screenshot harness, AC40 the owner's phone check in the PR, AC41 this scan plus review.
  it("AC19–AC37 each appear in a describe title that names Spec 10.4", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.4[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = Array.from({ length: 19 }, (_, i) => i + 19);
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
