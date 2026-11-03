import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const workouts = raw(import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const routines = raw(import.meta.glob(["../routines/*.ts", "../routines/*.tsx", "!../routines/*.test.ts", "!../routines/*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const web = raw(import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx", "!../../test/**"], { query: "?raw", import: "default", eager: true }));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** Static `from "…"`, bare `import "…"` and dynamic `import("…")` specifiers. */
const imports = (source: string) =>
  [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

describe("10.1 AC28 — workouts/ ↔ routines/ module boundary", () => {
  it("workouts/ imports only the three leaf modules (and the pre-existing RoutinesSection) from routines/", () => {
    const allowed = new Set(["../routines/targetFormat", "../routines/LinkToggle", "../routines/SupersetBracket", "../routines/RoutinesSection"]);
    const offenders = Object.entries(workouts).flatMap(([path, src]) => imports(src).filter((i) => i.startsWith("../routines/") && !allowed.has(i)).map((i) => `${path} → ${i}`));
    expect(offenders).toEqual([]);
    expect(Object.keys(workouts).length).toBeGreaterThan(10);
  });
  it("the three leaf modules import nothing from workouts/", () => {
    for (const leaf of ["../routines/targetFormat.ts", "../routines/LinkToggle.tsx", "../routines/SupersetBracket.tsx"]) {
      expect(routines[leaf], leaf).toBeDefined();
      expect(imports(routines[leaf]!).filter((i) => i.includes("workouts"))).toEqual([]);
    }
  });
});

describe("10.7 AC61 — workouts/ and history/ may import sectionTimer/, which imports neither", () => {
  // Glob keys are relative to this file: workouts/** reads as "./…", its siblings as "../history/…" and so on.
  const all = raw(import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], { query: "?raw", import: "default", eager: true }));
  it("workouts/** reaches sectionTimer/ only by a relative path to it", () => {
    const hits = Object.entries(all)
      .filter(([path]) => path.startsWith("./"))
      .flatMap(([path, src]) => imports(src).filter((i) => i.includes("sectionTimer/")).map((i) => [path, i] as const));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter(([, i]) => !/^(\.\.\/)+sectionTimer\//.test(i))).toEqual([]);
  });

  it("history/ imports, among the new paths, only sectionTimer/", () => {
    const history = Object.entries(all).filter(([path]) => path.startsWith("../history/"));
    const fromHistory = history.flatMap(([path, src]) => imports(src).filter((i) => /sectionTimer\/|workouts\/sections\//.test(i)).map((i) => `${path} → ${i}`));
    expect(fromHistory.filter((s) => !/→ \.\.\/sectionTimer\//.test(s))).toEqual([]);
    expect(fromHistory.some((s) => s.startsWith("../history/HistoryRow.tsx"))).toBe(true);
  });

  it("sectionTimer/ imports nothing from routines/, workouts/ or history/", () => {
    const offenders = Object.entries(all)
      .filter(([path]) => path.startsWith("../sectionTimer/"))
      .flatMap(([path, src]) => imports(src).filter((i) => /(^|\/)(routines|workouts|history)\//.test(i)).map((i) => `${path} → ${i}`));
    expect(offenders).toEqual([]);
  });
});

describe("10.1 AC24 — both session screens share supersetRows and compute no runs themselves", () => {
  it.each(["./ActiveSession.tsx", "./FinishedWorkoutScreen.tsx"])("%s", (path) => {
    const src = stripComments(workouts[path]!);
    expect(src).toContain("supersetRows(");
    expect(src).not.toMatch(/runPosition\(|runOrdinals\(/);
  });
});

describe("10.1 AC14 — the regroup path is online-only and stores nothing", () => {
  it("useRegroup / supersetRows import nothing from outbox/ and name no browser storage", () => {
    for (const path of ["./useRegroup.ts", "./supersetRows.ts"]) {
      const src = stripComments(workouts[path]!);
      expect(src).not.toMatch(/outbox/);
      expect(src).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});

describe("10.1 AC26 — the client adds no tolerant defaults to response schemas", () => {
  it("no .default(null) or .catch( anywhere in web sources", () => {
    expect(Object.keys(web).length).toBeGreaterThan(50);
    const offenders = Object.entries(web).filter(([, src]) => /\.default\(null\)|\.catch\(\s*null/.test(stripComments(src))).map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});

describe("10.1 AC27 — the files this spec adds carry no inline style or raw HTML", () => {
  it.each(["./useRegroup.ts", "./supersetRows.ts", "../routines/SupersetBracket.tsx"])("%s", (path) => {
    const src = stripComments(workouts[path] ?? routines[path]!);
    expect(src).not.toMatch(/\sstyle\s*=|<style|dangerouslySetInnerHTML/);
  });
});

const e2e = raw(import.meta.glob(["../../../e2e/*.ts"], { query: "?raw", import: "default", eager: true }));

describe("10.1 AC30 — the 06.3 browser smoke asserts nothing 10.1 changes", () => {
  it("no e2e source names a superset, the From routine line, or a grouped card's accessible name", () => {
    expect(Object.keys(e2e).length).toBeGreaterThan(0);
    const offenders = Object.entries(e2e).filter(([, src]) => /superset|From routine|routineName/i.test(src)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});
