import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripCssComments } from "../../test/sourceScan";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = stripCssComments(readFileSync(join(HERE, "ExerciseProgressBody.module.css"), "utf8"));
/** Every top-level rule as its selector list (split on commas) and its body. */
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
  selectors: m[1]!.split(",").map((s) => s.trim()),
  body: m[2]!,
}));

describe("17.11 AC10 — Open workout is a 44 px target", () => {
  it(".link has a rule of its own with the tap-target height, laid out inline-flex", () => {
    const own = rules.filter((r) => r.selectors.length === 1 && r.selectors[0] === ".link");
    expect(own).toHaveLength(1);
    expect(own[0]!.body).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(own[0]!.body).toMatch(/display:\s*inline-flex/);
  });

  it("no selector list names .link with .sessions", () => {
    const shared = rules.filter((r) => r.selectors.includes(".link") && r.selectors.includes(".sessions"));
    expect(shared).toEqual([]);
  });
});
