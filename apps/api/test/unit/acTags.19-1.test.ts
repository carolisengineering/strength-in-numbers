import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST = join(dirname(fileURLToPath(import.meta.url)), "..");
/** AC33 is the `bench:hevy-import` dev tool and AC36 is CI itself; neither is a test. */
const UNTESTED = new Set([33, 36]);

/** Spec 19.1 Phase B: every behavioral criterion appears in a describe title as "19.1 ACn". */
describe("19.1 AC36 — AC15–AC35 each have a tagged API test", () => {
  it("each Phase B criterion is tagged", () => {
    const tagged = new Set<number>();
    for (const dir of ["unit", "integration"]) {
      for (const f of readdirSync(join(TEST, dir)).filter((n) => n.endsWith(".test.ts"))) {
        const source = readFileSync(join(TEST, dir, f), "utf8");
        for (const title of source.matchAll(/describe(?:\.skipIf\([^)]*\))?\(\s*(["'`])([^"'`]*)\1/g)) {
          for (const ac of title[2]!.matchAll(/19\.1 AC(\d+)/g)) tagged.add(Number(ac[1]));
        }
      }
    }
    const wanted = Array.from({ length: 21 }, (_, i) => i + 15).filter((n) => !UNTESTED.has(n));
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
