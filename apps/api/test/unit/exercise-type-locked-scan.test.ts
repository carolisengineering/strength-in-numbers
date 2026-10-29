import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Block and line comments out, so a doc comment's example is not a throw site. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The text between a call's parentheses, from the `(` at `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced call");
}

/** Top-level arguments: commas inside nested parentheses, brackets or braces don't split. */
function topLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((a) => a.trim()).filter((a) => a !== "");
}

describe("Minor 105 — every real ExerciseTypeLockedError names both types", () => {
  it("each `new ExerciseTypeLockedError(` under src/ passes two arguments (the OpenAPI list names the class, never calls it)", () => {
    const sites: { file: string; args: string[] }[] = [];
    for (const f of files(SRC)) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/new\s+ExerciseTypeLockedError\s*\(/g)) {
        sites.push({ file: f, args: topLevelArgs(argsAt(src, m.index + m[0].length - 1)) });
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const s of sites) expect(s.args, s.file).toHaveLength(2);
  });

  it("the scan sees a bare call (self-check)", () => {
    const src = stripComments("throw new ExerciseTypeLockedError();");
    const m = /new\s+ExerciseTypeLockedError\s*\(/.exec(src)!;
    expect(topLevelArgs(argsAt(src, m.index + m[0].length - 1))).toEqual([]);
  });
});
