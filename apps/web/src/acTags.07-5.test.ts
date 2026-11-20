import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.07-5.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/**
 * Spec 07.5 AC34: the web's tagged criteria. Phase A tags AC1–AC4; Phase B adds AC31 and Phase C AC35–AC39 here.
 * This scan reads only `apps/web/src`, so the core and API tags of Phase B are checked by review. AC5 is Phase B's
 * gate (the owner's reload and Spec 21.1's S8), not a test. Only numbers written as "07.5 ACn" (or "07.5 ACn, ACm") count.
 */
const WANTED = [1, 2, 3, 4];

describe("07.5 AC34 — every web behavioral criterion has a committed, tagged test", () => {
  it("each wanted AC appears in a describe title as '07.5 ACn'", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
        for (const group of title[2]!.matchAll(/07\.5 ((?:AC\d+(?:\s*(?:,|\/|and)\s*)?)+)/g)) {
          for (const ac of group[1]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    expect(WANTED.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
