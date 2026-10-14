import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-3.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The note work (Tasks 10-12). If it is cut into Spec 10.4, delete this list's use below. */
const NOTE_ACS = [12, 13, 27, 28, 29, 30];

describe("10.3 AC40 — every behavioral criterion has a committed, tagged test", () => {
  // AC38 is the CI gate and the `git diff --stat` path check (Task 13 Step 7), AC39 the owner's phone check in the PR
  // description, AC40 this scan plus review — none is a unit test, so the scan covers AC1-AC37.
  it("AC1–AC37 each appear in a describe title that names Spec 10.3", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.3[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = Array.from({ length: 37 }, (_, i) => i + 1); // drop NOTE_ACS here if the note work was cut
    const missing = wanted.filter((n) => !tagged.has(n));
    expect(missing).toEqual([]);
    expect(NOTE_ACS.every((n) => n >= 12)).toBe(true);
  });
});
