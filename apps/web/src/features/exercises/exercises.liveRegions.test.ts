import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripCssComments } from "../../test/sourceScan";

const HERE = dirname(fileURLToPath(import.meta.url));
const ruleBody = (file: string, selector: string): string => {
  const css = stripCssComments(readFileSync(join(HERE, file), "utf8"));
  const match = new RegExp(`${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no ${selector} rule in ${file}`);
  return match[1]!;
};

describe("18.2 AC54 — the status lines stay in the accessibility tree while empty", () => {
  it.each([
    ["ExerciseScreen.module.css", ".status:empty"],
    ["AllExercises.module.css", ".notice:empty"],
    ["AllExercises.module.css", ".count:empty"],
  ])("%s %s collapses without leaving the tree", (file, selector) => {
    const body = ruleBody(file, selector);
    // `display: none` / `visibility: hidden` remove the live region, and VoiceOver then skips the text it gets.
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    expect(body).toMatch(/position:\s*absolute/);
  });
});
