import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-scan helpers for the tripwire tests (Spec 17.0 roles, fonts, contrast, harness isolation): one file
 * walk and one comment stripper, so every scan sees the same file set. Mirrors `scripts/assert-css-tokens.mjs`.
 */

/** Every file under `dir` whose name matches `match` (depth-first, `node_modules` skipped). */
export function filesUnder(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesUnder(path, match, out);
    else if (match.test(name)) out.push(path);
  }
  return out;
}

/** Strip `/* … *\/` comments so a documented value in a comment is not a hit. */
export const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every stylesheet under `dir`, read and comment-stripped. */
export function stylesheets(dir: string): Array<{ path: string; css: string }> {
  return filesUnder(dir, /\.css$/).map((path) => ({ path, css: stripCssComments(readFileSync(path, "utf8")) }));
}
