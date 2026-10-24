import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Spec 10.4 AC41 (core part): AC1–AC18 and the 2026-10-24 amendment's AC42–AC54 each appear in a describe title as "10.4 ACn". */
describe("10.4 AC41 — AC1–AC18 and AC42–AC54 each have a tagged core test", () => {
  it("each Phase A criterion is tagged", () => {
    const tagged = new Set<number>();
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".test.ts"))) {
      const source = readFileSync(join(DIR, f), "utf8");
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/10\.4 AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = [...Array.from({ length: 18 }, (_, i) => i + 1), ...Array.from({ length: 13 }, (_, i) => i + 42)];
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
