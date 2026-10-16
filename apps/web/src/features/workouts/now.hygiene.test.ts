import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Spec 17.1 Phase B scans. Sources and stylesheets are read from disk (a `?raw` glob of a CSS module yields the class map).
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const workouts = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("17.1 AC21 — seedDraft stays the only builder of a draft from a list", () => {
  it("the stepper files build no draft and mint no attempt key", () => {
    for (const path of ["./stepper.ts", "./NumberStepper.tsx", "./SetFields.tsx"]) {
      expect(stripComments(read(path)), path).not.toMatch(/attemptKey:|seedDraft\(|draftFromSet\(|dispatch\(/); // a type like Omit<SetDraft, "attemptKey"> is fine
    }
  });
  it("seedDraft( is called only from setDraft.ts and EntryRow.tsx", () => {
    const callers = Object.entries(workouts).filter(([, src]) => /\bseedDraft\(/.test(stripComments(src))).map(([p]) => p).sort();
    expect(callers).toEqual(["./EntryRow.tsx", "./setDraft.ts"]);
  });
});
