import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sources = filesUnder(SRC, /\.tsx?$/)
  .filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes(`${join("src", "test")}/`))
  .map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));

const EVENTS = ["custom_exercise_updated", "custom_exercise_forked", "custom_exercise_deleted"];

describe("18.2 AC53 — telemetry carries counts and booleans only", () => {
  it("the three events live only in the catalog store and the mutation hooks, with only their allowed props", () => {
    for (const event of EVENTS) {
      const users = sources.filter((s) => s.text.includes(`"${event}"`)).map((s) => s.path);
      expect(users.every((p) => p === "features/catalog/catalogStore.ts" || p === "features/exercises/useExerciseMutations.ts")).toBe(true);
      expect(users.length).toBeGreaterThan(0);
    }
    const calls = sources.flatMap((s) => [...s.text.matchAll(/track\("custom_exercise_(updated|forked|deleted)"([^)]*)\)/g)].map((m) => m[2] ?? ""));
    expect(calls).toHaveLength(3);
    for (const props of calls) {
      // Object keys only: a word right after `{` or `,` and before `:`, `,` or `}` (shorthand included).
      const keys = [...props.matchAll(/[{,]\s*(\w+)\s*(?=[:,}])/g)].map((m) => m[1]);
      expect(keys.every((k) => k === "typeChanged" || k === "routineCount")).toBe(true);
    }
  });

  it("exercises/ reports only a static op and the error", () => {
    const reports = sources
      .filter((s) => s.path.startsWith("features/exercises/"))
      .flatMap((s) => [...s.text.matchAll(/report(?:Unexpected|Error)\(([^)]*)\)/g)].map((m) => m[1]!.trim()));
    expect(reports.length).toBeGreaterThan(0);
    for (const args of reports) expect(args).toMatch(/^(?:"[a-z-]+"|op), (?:\w+\.)?error$/);
  });
});
