import { describe, expect, it } from "vitest";

const web = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.06-7.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Spec 06.7 AC41. Phase A: AC1–AC12 (the outbox half). Phases B1 (AC13–AC20), B2 (AC21–AC35) and C (AC36–AC39, the
 * Playwright smoke under `e2e/`) widen this range as they land.
 */
const CRITERIA = Array.from({ length: 12 }, (_, i) => i + 1);

describe("06.7 AC41 — every behavioral criterion has a committed, tagged test", () => {
  // This checks tags, not how well a tagged test covers its AC.
  it("each listed AC appears in a describe title that names Spec 06.7", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(web)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*06\.7[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    expect(CRITERIA.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
