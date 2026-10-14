import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const web = raw(import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx", "!../../test/**"], { query: "?raw", import: "default", eager: true }));
// The added files are read from disk: a `?raw` glob proved order-dependent when several test files ran in one worker.
// Stylesheets are read from disk: Vite turns a `*.module.css?raw` import into the class map, not the text.
const here = dirname(fileURLToPath(import.meta.url));
const fromDisk = (path: string): string | undefined => {
  try {
    return readFileSync(join(here, path), "utf8");
  } catch {
    return undefined;
  }
};
const local = new Proxy({} as Record<string, string | undefined>, { get: (_t, path: string) => fromDisk(path) });
const css = new Proxy({} as Record<string, string>, { get: (_t, path: string) => readFileSync(join(here, path), "utf8") });
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source: string) => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

/** The files Spec 10.3 adds (source); the note files are listed separately so the note work can be cut cleanly. */
const ADDED = [
  "../routines/sectionText.ts", "../routines/routineSections.ts", "../routines/SectionHeader.tsx", "../routines/SectionSheet.tsx",
  "../routines/AddSectionSheet.tsx", "../routines/MoveToSectionSheet.tsx", "./sectionSegments.ts", "./SessionSectionHeading.tsx", "./RoutineNotePanel.tsx",
];
const ADDED_NOTES = ["./exerciseNote.ts", "./NoteSheet.tsx"];
const sourceOf = (path: string) => local[path];

describe("10.3 AC33 — strict schemas stay strict", () => {
  it("no .default( / .catch( sits on sections, sectionId or routineNotes anywhere in web sources", () => {
    expect(Object.keys(web).length).toBeGreaterThan(50);
    const near = /(sections|sectionId|routineNotes)[^\n;]{0,120}\.(default|catch)\(|\.(default|catch)\([^\n;]{0,120}(sections|sectionId|routineNotes)/;
    expect(Object.entries(web).filter(([, src]) => near.test(stripComments(src))).map(([p]) => p)).toEqual([]);
  });
});

describe("10.3 AC34 — boundaries and purity", () => {
  it("the added files live where the spec puts them: the editor's heading under routines/, the session's and sectionSegments under workouts/", () => {
    for (const path of [...ADDED, ...ADDED_NOTES]) expect(sourceOf(path), path).toBeDefined();
  });
  it("the new pure modules import only @sin/core, siblings, ui/ and the allowed targetFormat leaf", () => {
    for (const path of ["../routines/sectionText.ts", "../routines/routineSections.ts", "./sectionSegments.ts", "./exerciseNote.ts"]) {
      const bad = imports(sourceOf(path)!).filter((i) => !(i === "@sin/core" || i.startsWith("./") || i === "../routines/targetFormat" || i.startsWith("zod")));
      expect(bad, path).toEqual([]);
    }
  });
  it("no workouts/ file imports a routines/ module beyond the 10.1 leaves (the 10.1 AC28 scan itself runs unmodified)", () => {
    const allowed = new Set(["../routines/targetFormat", "../routines/LinkToggle", "../routines/SupersetBracket", "../routines/RoutinesSection"]);
    const offenders = ADDED.concat(ADDED_NOTES).filter((p) => p.startsWith("./")).flatMap((p) => imports(sourceOf(p)!).filter((i) => i.startsWith("../routines/") && !allowed.has(i)));
    expect(offenders).toEqual([]);
  });
});

describe("10.3 AC35 — no new analytics or error reporting", () => {
  it("none of the added files imports track or reportError", () => {
    for (const path of [...ADDED, ...ADDED_NOTES]) expect(imports(sourceOf(path)!).filter((i) => /observability/.test(i)), path).toEqual([]);
  });
});

describe("10.3 AC36 — user text is text", () => {
  it("the added files carry no inline style, raw HTML or innerHTML", () => {
    for (const path of [...ADDED, ...ADDED_NOTES]) expect(stripComments(sourceOf(path)!), path).not.toMatch(/\sstyle\s*=|<style|dangerouslySetInnerHTML|innerHTML/);
  });
  it("the stylesheets that show user text wrap it in full (pre-wrap) and never clamp it", () => {
    for (const path of ["../routines/Sections.module.css", "./SessionSectionHeading.module.css", "./RoutineNotePanel.module.css"]) {
      expect(css[path], path).toMatch(/white-space:\s*pre-wrap/);
      expect(css[path], path).not.toMatch(/line-clamp|text-overflow:\s*ellipsis/);
    }
  });
});
