import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Comments out: `/* … *\/` (JSX `{/* … *\/}` included) and `// …` (not the one in `https://`). */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every bare `RPE` token left once comments are stripped. Identifiers never hold the token on its own (they are
 * `rpe`, `targetRpe`, `RPE_CHOICES`, where `_` is a word character), so whatever matches is in a string, a
 * template or JSX text — including JSX that interpolates (`<dd>RPE {value}</dd>`).
 */
export function userVisibleText(source: string): string[] {
  return [...stripComments(source).matchAll(/\bRPE\b[^\n]{0,40}/g)].map((m) => m[0]);
}

/** Nothing is allowed: the last RPE message (validateDraft's) went with the code-review pass (17.1 AC7). */
const ALLOWED: Array<{ file: string; text: string }> = [];

describe("17.1 AC7 — no user-visible RPE text in the web sources", () => {
  it("the scanner sees strings, templates and JSX text (interpolated too) but not identifiers or comments (self-check)", () => {
    const sample = [
      'const a = "RPE must be 1–10";',
      "const b = `RPE ${n}`;",
      "const c = <label>RPE</label>;",
      "const d = <dd>RPE {value}</dd>;",
      "const targetRpe = 1; // RPE in a comment",
      "/* RPE in a block */ const rpe = RPE_CHOICES;",
    ].join("\n");
    expect(userVisibleText(sample)).toHaveLength(4);
    expect(userVisibleText(sample).every((t) => t.startsWith("RPE"))).toBe(true);
  });

  it("no non-test .ts/.tsx under src/ has a string literal or JSX text containing the token RPE", () => {
    const files = filesUnder(SRC, /\.tsx?$/).filter(
      (f) => !/\.test\.tsx?$/.test(f) && !relative(SRC, f).startsWith("test/"),
    );
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      for (const text of userVisibleText(readFileSync(file, "utf8"))) {
        if (!/\bRPE\b/.test(text)) continue; // "rpe" / "targetRpe" are field keys, not copy
        if (ALLOWED.some((a) => a.file === rel && text.includes(a.text))) continue;
        hits.push(`${rel}: ${text}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the allow-list entry still exists (a stale entry would hide a regression)", () => {
    for (const a of ALLOWED) expect(readFileSync(join(SRC, a.file), "utf8")).toContain(a.text);
  });
});
