import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const workouts = raw(import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const routines = raw(import.meta.glob(["../routines/*.ts", "../routines/*.tsx", "!../routines/*.test.ts", "!../routines/*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// `PlanRowList.tsx` is the plan rows component (not `PlanRows.tsx`: that differs from `planRows.ts` only by case).
const NEW_ROUTINES = ["PlanRowList.tsx", "UnitToggle.tsx", "ItemSheet.tsx", "planRows.ts", "sheetIssues.ts"].map((f) => `../routines/${f}`);
const NEW_WORKOUTS = ["./plannedSets.ts", "./setDraft.ts", "./EntryRow.tsx", "./supersetRows.ts"];

describe("10.2 AC34 — the files this spec adds or changes", () => {
  it.each([...NEW_ROUTINES, ...NEW_WORKOUTS])("%s: no inline styles, raw HTML, number inputs or browser storage", (path) => {
    const src = stripComments(routines[path] ?? workouts[path] ?? "");
    expect(src.length, path).toBeGreaterThan(0);
    expect(src).not.toMatch(/\sstyle\s*=|<style|dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/type=["']number["']/);
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("10.2 AC32 — purity and the module boundary", () => {
  it("the pure modules import no React and nothing from the DOM", () => {
    for (const path of ["../routines/planRows.ts", "../routines/sheetIssues.ts", "./plannedSets.ts"]) {
      const src = stripComments(routines[path] ?? workouts[path]!);
      expect(src, path).not.toMatch(/from ["']react["']|document\.|window\./);
    }
  });
  it("workouts/ still imports only the three leaf modules from routines/ (10.1 AC28 is unmodified and green)", () => {
    const allowed = new Set(["../routines/targetFormat", "../routines/LinkToggle", "../routines/SupersetBracket", "../routines/RoutinesSection"]);
    const imports = (s: string) => [...stripComments(s).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    const offenders = Object.entries(workouts).flatMap(([p, s]) => imports(s).filter((i) => i.startsWith("../routines/") && !allowed.has(i)).map((i) => `${p} → ${i}`));
    expect(offenders).toEqual([]);
  });
  // RoutinePreview already imports the start hook from workouts/ (Spec 10.0); the files this spec adds must not.
  it("the routines/ files this spec adds import nothing from workouts/ (the plan rows have their own set-type labels)", () => {
    const offenders = NEW_ROUTINES.filter((p) => /from\s+["']\.\.\/workouts\//.test(stripComments(routines[p] ?? "")));
    expect(offenders).toEqual([]);
  });
});
