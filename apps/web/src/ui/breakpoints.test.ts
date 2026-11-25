import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { filesUnder, stripCssComments } from "../test/sourceScan";
import { DESKTOP_QUERY } from "./breakpoints";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (path: string) => relative(SRC, path).split("\\").join("/");
const tokensCss = stripCssComments(readFileSync(join(SRC, "ui/tokens.css"), "utf8"));

/** Every non-test CSS, TS and TSX file under `src` (the test helpers included: none sets a breakpoint). */
const sources = filesUnder(SRC, /\.(css|ts|tsx)$/)
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .map((path) => ({ path: rel(path), text: stripCssComments(readFileSync(path, "utf8")) }));

/** The two widths a media condition may name (`--bp-tablet`, `--bp-desktop`). */
const ALLOWED = ["48rem", "64rem"];

/**
 * Each width condition in a file: `(min-width: …)` / `(max-width: …)` anywhere, and in a stylesheet also the range
 * form `(width >= …)` (minor 648). TypeScript reads only the first form, so a parameter such as `viewFor(width: number)`
 * is never taken for a condition.
 */
function conditionsIn(path: string, text: string): { condition: string; width: string }[] {
  const pattern = path.endsWith(".css") ? /\((?:(?:min|max)-width\s*:|width\s*[<>]=?)\s*([^)]+)\)/g : /\((?:min|max)-width\s*:\s*([^)]+)\)/g;
  return [...text.matchAll(pattern)].map((m) => ({ condition: m[0], width: m[1]?.trim() ?? "" }));
}

describe("17.12 AC1 — breakpoints are tokens, and every media condition uses one of them", () => {
  it("tokens.css declares the layout tokens with their exact values", () => {
    const css = tokensCss;
    expect(css).toMatch(/--bp-tablet:\s*48rem;/);
    expect(css).toMatch(/--bp-desktop:\s*64rem;/);
    expect(css).toMatch(/--sidebar-width:\s*15rem;/);
    expect(css).toMatch(/--pane-list-width:\s*20rem;/);
    expect(css).toMatch(/--content-max-wide:\s*80rem;/);
  });

  it("DESKTOP_QUERY is the desktop breakpoint's min-width", () => {
    const desktop = /--bp-desktop:\s*([^;]+);/.exec(tokensCss)?.[1]?.trim();
    expect(DESKTOP_QUERY).toBe(`(min-width: ${desktop})`);
  });

  it("no (min-width) / (max-width) condition in src names another width", () => {
    const offenders: string[] = [];
    let conditions = 0;
    for (const { path, text } of sources) {
      for (const { condition, width } of conditionsIn(path, text)) {
        conditions += 1;
        if (!ALLOWED.includes(width)) offenders.push(`${path}: ${condition}`);
      }
    }
    // The scan reads something: the shell's and the front door's 48rem conditions at least.
    expect(conditions).toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });

  it("minor 648: a range condition in a stylesheet is read; a TypeScript parameter named width is not", () => {
    expect(conditionsIn("x.module.css", "@media (width >= 50rem) {")).toEqual([{ condition: "(width >= 50rem)", width: "50rem" }]);
    expect(conditionsIn("scale.ts", "export function viewFor(width: number) {")).toEqual([]);
  });
});
