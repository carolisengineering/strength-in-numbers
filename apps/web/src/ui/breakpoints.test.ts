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
 * forms, one entry per width they name: `(width >= …)` (minor 648), `(… <= width)` and `(… <= width < …)` (minor 755).
 * TypeScript reads only the first form, so a parameter such as `viewFor(width: number)` is never taken for a
 * condition; a range inside a `matchMedia` string isn't read either.
 */
function conditionsIn(path: string, text: string): { condition: string; width: string }[] {
  if (!path.endsWith(".css")) {
    return [...text.matchAll(/\((?:min|max)-width\s*:\s*([^)]+)\)/g)].map((m) => ({ condition: m[0], width: m[1]?.trim() ?? "" }));
  }
  // `width` on its own, never inside a custom property's name (`var(--focus-ring-width)`), or the min/max form.
  return [...text.matchAll(/\(([^()]*(?:(?<![-\w])width(?![-\w])|\b(?:min|max)-width\s*:)[^()]*)\)/g)].flatMap((m) => {
    const inner = m[1]!;
    const minMax = /^\s*(?:min|max)-width\s*:\s*(.+)$/.exec(inner);
    if (minMax) return [{ condition: m[0], width: minMax[1]!.trim() }];
    return inner
      .split(/[<>]=?|=/)
      .map((operand) => operand.trim())
      .filter((operand) => operand !== "" && operand !== "width")
      .map((width) => ({ condition: m[0], width }));
  });
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

  it("minor 755: a reversed and a two-sided range in a stylesheet are read", () => {
    expect(conditionsIn("x.module.css", "@media (50rem <= width) {")).toEqual([{ condition: "(50rem <= width)", width: "50rem" }]);
    expect(conditionsIn("x.module.css", "@media (48rem <= width < 64rem) {")).toEqual([
      { condition: "(48rem <= width < 64rem)", width: "48rem" },
      { condition: "(48rem <= width < 64rem)", width: "64rem" },
    ]);
    expect(conditionsIn("x.module.css", "outline: var(--focus-ring-width) solid; max-width: var(--pane-list-width);")).toEqual([]);
  });
});
