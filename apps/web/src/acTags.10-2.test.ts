import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-2.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// A title may contain the other kinds of quote ("the exercise's modality"), so each quote style gets its own branch.
const DESCRIBE_TITLE = /describe\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

describe("10.2 AC37 — every behavioral criterion has a committed, tagged test", () => {
  // AC35 is the CI gate and the `git diff --stat` path check (Task 11 Step 6), AC36 the owner's phone check in the PR
  // description, AC37 this scan plus review — none of those is a unit test, so the scan covers AC1–AC34.
  it("AC1–AC34 each appear in a describe title that names Spec 10.2", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const match of source.matchAll(DESCRIBE_TITLE)) {
        const title = match[1] ?? match[2] ?? match[3] ?? "";
        if (!title.includes("10.2")) continue;
        for (const ac of title.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const missing = Array.from({ length: 34 }, (_, i) => i + 1).filter((n) => !tagged.has(n));
    expect(missing).toEqual([]);
  });
});
