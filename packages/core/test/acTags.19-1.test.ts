import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, "../src");

/** The Phase A modules (Spec 19.1 §3.2). */
const IMPORT_MODULES = [
  "dto/hevy-import.ts",
  "hevy/importText.ts",
  "hevy/importShared.ts",
  "hevy/importWorkout.ts",
  "hevy/duplicate.ts",
  "hevy/importRoutine.ts",
  "hevy/importTemplate.ts",
];

describe("19.1 AC13 — the import schemas are exported, so the static-message probe reaches them", () => {
  it("each new schema is an exported Zod schema, so static-issue-messages.test.ts probes it", () => {
    const names = [
      "HevyImportSetSchema",
      "HevyImportExerciseSchema",
      "HevyImportWorkoutSchema",
      "HevyImportBatchSchema",
      "HevyImportResultSchema",
      "HevyImportResponseSchema",
      "HevyImportFinishResponseSchema",
    ];
    for (const name of names) expect("_zod" in ((core as Record<string, unknown>)[name] as object), name).toBe(true);
  });
});

describe("19.1 AC14 — no clock, Intl, randomness or DOM in the import modules", () => {
  it.each(IMPORT_MODULES)("%s", (file) => {
    const source = readFileSync(join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const banned of [/\bDate\.now\b/, /new Date\(\s*\)/, /\bIntl\b/, /\bMath\.random\b/, /\bwindow\b/, /\bdocument\b/, /\bperformance\b/]) {
      expect(source, String(banned)).not.toMatch(banned);
    }
  });
});

/** Spec 19.1 Phase A: AC1–AC14 each appear in a describe title as "19.1 ACn". */
describe("19.1 AC14 — AC1–AC14 each have a tagged core test", () => {
  it("each Phase A criterion is tagged", () => {
    const tagged = new Set<number>();
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".test.ts"))) {
      const source = readFileSync(join(DIR, f), "utf8");
      for (const title of source.matchAll(/describe\(\s*(["'`])([^"'`]*)\1/g)) {
        for (const ac of title[2]!.matchAll(/19\.1 AC(\d+)/g)) tagged.add(Number(ac[1]));
      }
    }
    const wanted = Array.from({ length: 14 }, (_, i) => i + 1);
    expect(wanted.filter((n) => !tagged.has(n))).toEqual([]);
  });
});
