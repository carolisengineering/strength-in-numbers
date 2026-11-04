import { describe, expect, it } from "vitest";

const web = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.10-7.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// AC12's grouping rules are pure @sin/core (supersets.ts), and so is Phase D's reader (AC44–AC54); their tests live there.
const core = import.meta.glob(
  ["../../../packages/core/test/supersets*.test.ts", "../../../packages/core/test/workoutText*.test.ts", "../../../packages/core/test/importPlan*.test.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * Phase A: AC1–AC14 and the Phase A parts of AC56, AC58, AC59, AC61. Phase B: AC15–AC26 and AC57 (its parts of
 * AC56–AC61 share the numbers above). Phase C: AC27–AC43 and AC62 (AC60's token scans are tagged too). Phase D:
 * AC44–AC55. With all four phases in, this is the spec's full set: AC1–AC62 and AC66 (AC63 is the harness run).
 */
const CRITERIA = [...Array.from({ length: 62 }, (_, i) => i + 1), 66];

describe("10.7 AC65 — every behavioral criterion has a committed, tagged test", () => {
  // AC63 is the screenshot harness, AC64 the owner's phone check in the PR description, AC65 this scan plus review.
  // This checks tags, not how well a tagged test covers its AC.
  it("each listed AC appears in a describe title that names Spec 10.7", () => {
    expect(Object.keys(core).length).toBeGreaterThan(0);
    const tagged = new Set<number>();
    for (const source of [...Object.values(web), ...Object.values(core)]) {
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*10\.7[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    expect(CRITERIA.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
