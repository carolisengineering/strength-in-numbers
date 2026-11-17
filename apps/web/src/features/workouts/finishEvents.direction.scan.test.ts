import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Block comments and `//` line comments; a `//` after a colon is a URL's, not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsFrom = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

const FINISH_FILES = ["finishEvents.ts", "finishLanding.ts", "useWorkoutMutations.ts", "ActiveSession.tsx"];

describe("20.2 AC24 — direction", () => {
  it.each(FINISH_FILES)("%s imports nothing from features/hevy", (file) => {
    const specs = importsFrom(stripComments(readFileSync(join(HERE, file), "utf8")));
    expect(specs.filter((spec) => /(^|\/)hevy(\/|$)/.test(spec))).toEqual([]);
  });

  it("Spec 06.7 AC14: the landing effects are the one emitter; the tap's code never emits", () => {
    expect(stripComments(readFileSync(join(HERE, "finishLanding.ts"), "utf8"))).toContain("emitWorkoutFinished(");
    for (const file of ["useWorkoutMutations.ts", "ActiveSession.tsx"]) {
      expect(stripComments(readFileSync(join(HERE, file), "utf8"))).not.toContain("emitWorkoutFinished(");
    }
  });
});
