import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-6.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Both phases: AC1–AC27 (AC17–AC21 are Phase B's edit screen). */
const CRITERIA = Array.from({ length: 27 }, (_, i) => i + 1);

describe("10.6 AC30 — every behavioral criterion has a committed, tagged test", () => {
  // AC28 is the screenshot harness, AC29 the owner's phone check in the PR description, AC30 this scan plus review —
  // none is a unit test. This checks tags, not how well a tagged test covers its AC.
  it("each of AC1–AC27 appears in a describe title that names Spec 10.6", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.6[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    expect(CRITERIA.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
