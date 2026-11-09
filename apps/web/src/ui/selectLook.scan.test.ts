import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { filesUnder, stylesheets } from "../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (path: string) => relative(SRC, path).split("\\").join("/");
const stripTsComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The selector lists of a stylesheet (the text before each `{`), at-rule preludes left out. */
const selectorsOf = (css: string): string[] =>
  [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((selector) => !selector.startsWith("@"));
const targetsSelect = (selector: string): boolean => /(^|[\s,>+~(])select\b/.test(selector) || /\.select\b/.test(selector);

describe("17.7 AC5 — one look for every select", () => {
  it("no component but ui/Select renders a <select>", () => {
    const offenders = filesUnder(SRC, /\.tsx$/)
      .filter((path) => !/\.test\.tsx$/.test(path))
      .filter((path) => /<select\b/.test(stripTsComments(readFileSync(path, "utf8"))))
      .map(rel);
    expect(offenders).toEqual(["ui/Select.tsx"]);
  });

  it("no stylesheet styles a select except Select's own, Field's shared rule and the reset", () => {
    const allowed = new Set(["ui/Select.module.css", "ui/Field.module.css", "ui/reset.css"]);
    const offenders = stylesheets(SRC)
      .filter((sheet) => !allowed.has(rel(sheet.path)))
      .flatMap((sheet) => selectorsOf(sheet.css).filter(targetsSelect).map((selector) => `${rel(sheet.path)}: ${selector}`));
    expect(offenders).toEqual([]);
  });

  it("Select and Field read the same height and radius tokens, with no data: URL", () => {
    for (const path of ["Select.module.css", "Field.module.css"]) {
      const css = readFileSync(join(SRC, "ui", path), "utf8");
      expect(css).toContain("var(--tap-target-min)");
      expect(css).toContain("var(--radius-sm)");
      expect(css).not.toContain("data:");
    }
  });
});
