import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const result = raw(import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const sections = raw(import.meta.glob(["../sections/*.ts", "../sections/*.tsx", "!../sections/*.test.*"], { query: "?raw", import: "default", eager: true }));
const sectionTimer = raw(import.meta.glob(["../../sectionTimer/*.ts", "../../sectionTimer/*.tsx", "!../../sectionTimer/*.test.*"], { query: "?raw", import: "default", eager: true }));
const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source: string) => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

describe("10.7 AC58 — Log result keeps text as text and stores nothing", () => {
  it("no raw HTML, inline style or browser storage in result/", () => {
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(5);
    const hits = Object.entries(result).filter(([, src]) => /dangerouslySetInnerHTML|innerHTML|style=|<style|localStorage|sessionStorage/.test(stripComments(src)));
    expect(hits.map(([p]) => p)).toEqual([]);
  });
});

describe("10.7 AC61 — result/ boundaries", () => {
  it("result/ imports nothing from routines/, history/ or edit/", () => {
    const offenders = Object.entries(result).flatMap(([p, src]) => imports(src).filter((i) => /(^|\/)(routines|history|edit)\//.test(i)).map((i) => `${p} → ${i}`));
    expect(offenders).toEqual([]);
  });

  it("nothing in sections/ or sectionTimer/ imports result/", () => {
    const offenders = Object.entries({ ...sections, ...sectionTimer }).flatMap(([p, src]) => imports(src).filter((i) => /(^|\/)result\//.test(i)).map((i) => `${p} → ${i}`));
    expect(offenders).toEqual([]);
  });

  it("sectionTimer/ still imports neither routines/ nor workouts/", () => {
    const offenders = Object.entries(sectionTimer).flatMap(([p, src]) => imports(src).filter((i) => /(^|\/)(routines|workouts)\//.test(i)).map((i) => `${p} → ${i}`));
    expect(offenders).toEqual([]);
  });

  it("only useResultMutations names the live client in result/", () => {
    const live = Object.entries(result).filter(([, src]) => /\buseWorkoutClient\b|WORKOUT_KEYS\.active|\buseOutbox\b/.test(stripComments(src))).map(([p]) => p);
    expect(live).toEqual(["./useResultMutations.ts"]);
  });
});

describe("10.7 AC60 — tokens", () => {
  it("ResultSheet.module.css has no hex or px literal and no brass", () => {
    const css = readFileSync(join(here, "ResultSheet.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\d+px\b|--color-pr\b/i);
  });
});
