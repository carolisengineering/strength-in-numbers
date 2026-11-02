import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const folder = raw(import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
// Vitest does not hand back raw CSS through import.meta.glob (see workouts/a11y.test.tsx).
const stylesheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sectionTimer.module.css"), "utf8");
const web = raw(import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx", "!../../test/**"], { query: "?raw", import: "default", eager: true }));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** Static `from "…"`, bare `import "…"` and dynamic `import("…")` specifiers. */
const imports = (source: string) => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

/** Files that padded clock parts before Spec 10.7 (their own date and target formats), plus the field's digits. */
const PAD_ALLOWED = new Set([
  "../progress/dates.ts",
  "../progress/scale.ts",
  "../routines/targetFormat.ts",
  "./clockDigits.ts",
  "../workouts/changeTime/changeTime.ts",
  "../workouts/format.ts",
]);
/** Files whose set text used " × " before Spec 10.7 ("5 × 60 kg"); a timer's plan text comes only from describeTimer. */
const TIMES_ALLOWED = new Set(["../progress/metrics.ts", "../workouts/logAction.ts", "../workouts/format.ts", "../workouts/summaryLine.ts", "../routines/targetFormat.ts"]);
const rel = (path: string) => path.replace(/^\.\.\/\.\.\/features\/sectionTimer\//, "./").replace(/^\.\.\/\.\.\/features\//, "../");

describe("10.7 AC7 — no second formatter", () => {
  it("no new padStart(2 outside the clock digits and the files that already had one", () => {
    const offenders = Object.entries(web)
      .filter(([, src]) => stripComments(src).includes("padStart(2"))
      .map(([path]) => rel(path))
      .filter((p) => !PAD_ALLOWED.has(p));
    expect(offenders).toEqual([]);
    expect(Object.keys(web).length).toBeGreaterThan(100);
  });

  it('no "Set Timer " and no " × " template in the web', () => {
    const code = Object.entries(web).map(([path, src]) => [rel(path), stripComments(src)] as const);
    expect(code.filter(([, src]) => src.includes('"Set Timer ')).map(([p]) => p)).toEqual([]);
    const times = code.filter(([, src]) => /` × | × `|\$\{[^}]*\} × /.test(src)).map(([p]) => p);
    expect(times.filter((p) => !TIMES_ALLOWED.has(p))).toEqual([]);
  });
});

describe("10.7 AC58 — text as text (scan)", () => {
  it("no raw HTML, inline style or browser storage in sectionTimer/", () => {
    for (const [path, src] of [...Object.entries(folder), ["sectionTimer.module.css", stylesheet] as const]) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(/dangerouslySetInnerHTML|innerHTML|style=|<style|localStorage|sessionStorage/);
    }
  });
});

describe("10.7 AC61 — sectionTimer is a leaf", () => {
  it("imports nothing from routines/ or workouts/", () => {
    const offenders = Object.entries(folder).flatMap(([path, src]) => imports(src).filter((i) => /\.\.\/(routines|workouts)\//.test(i)).map((i) => `${path} → ${i}`));
    expect(offenders).toEqual([]);
    expect(Object.keys(folder).length).toBeGreaterThanOrEqual(6);
  });
});
