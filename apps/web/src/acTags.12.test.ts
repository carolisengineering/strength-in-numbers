import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.12.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("12 AC27 — every behavioral criterion has a committed, tagged test", () => {
  // AC25 is the CI gate + the diff-path check (Task 9 Step 6), AC26 the owner's phone check in the PR description.
  it("AC1–AC24 each appear in a describe title that names Spec 12", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])(12 AC[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const missing = Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => !tagged.has(n));
    expect(missing).toEqual([]);
  });
});
