import { describe, expect, it } from "vitest";

const tests = import.meta.glob(["./**/*.test.ts", "./**/*.test.tsx", "!./acTags.20-1.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("20.1 AC30 — every criterion has a committed, tagged test", () => {
  // AC1–AC28, AC29 (step focus and structure; the harness covers the rest), AC30, AC32.
  // AC31 is the staging rehearsal (gym checklist).
  it("each wanted criterion appears in a describe title that names Spec 20.1", () => {
    const tagged = new Set<number>();
    for (const source of Object.values(tests)) {
      for (const title of source.matchAll(/describe\(\s*(["'`])(20\.1 AC[^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = [...Array.from({ length: 28 }, (_, i) => i + 1), 29, 30, 32];
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
