import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Comments out: `/* … *\/` (JSX `{/* … *\/}` included) and `// …` (not the one in `https://`). */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * What a lifter could read: the text of every string / template literal and every run of JSX text. Identifiers
 * (`rpe`, `targetRpe`, `RPE_CHOICES`) and comments are not user-visible, so they are not in the result.
 */
export function userVisibleText(source: string): string[] {
  const code = stripComments(source);
  const literals = [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
  const jsxText = [...code.matchAll(/>([^<>{}=;]*[A-Za-z][^<>{}=;]*)</g)].map((m) => m[1]!);
  return [...literals, ...jsxText];
}

/** Server-path messages the spec allows to stay: validateDraft's `targetRpe` text cannot fire from the UI (17.1 AC7). */
const ALLOWED: Array<{ file: string; text: string }> = [
  { file: "features/routines/validateDraft.ts", text: "Pick an RPE from the list" },
];

describe("17.1 AC7 — no user-visible RPE text in the web sources", () => {
  it("the scanner sees string literals and JSX text but not identifiers or comments (self-check)", () => {
    const sample = [
      'const a = "RPE must be 1–10";',
      "const b = `RPE ${n}`;",
      "const c = <label>RPE</label>;",
      "const targetRpe = 1; // RPE in a comment",
      "/* RPE in a block */ const rpe = RPE_CHOICES;",
    ].join("\n");
    expect(userVisibleText(sample).filter((t) => /\bRPE\b/.test(t))).toEqual(['"RPE must be 1–10"', "`RPE ${n}`", "RPE"]);
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
