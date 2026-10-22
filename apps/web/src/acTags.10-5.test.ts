import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-5.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("10.5 AC28 — every behavioral criterion has a committed, tagged test", () => {
  // AC26 is the screenshot harness, AC27 the owner's phone check in the PR description, AC28 this scan plus review —
  // none is a unit test, so the scan covers AC1-AC25. This checks tags, not how well a tagged test covers its AC.
  it("AC1–AC25 each appear in a describe title that names Spec 10.5", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.5[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const missing = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !tagged.has(n));
    expect(missing).toEqual([]);
  });
});
