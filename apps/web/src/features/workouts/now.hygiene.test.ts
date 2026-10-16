import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { filesUnder, stylesheets } from "../../test/sourceScan";

// Spec 17.1 Phase B scans. Sources and stylesheets are read from disk (a `?raw` glob of a CSS module yields the class map).
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const workouts = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("17.1 AC21 — seedDraft stays the only builder of a draft from a list", () => {
  it("the stepper files build no draft and mint no attempt key", () => {
    for (const path of ["./stepper.ts", "./NumberStepper.tsx", "./SetFields.tsx"]) {
      expect(stripComments(read(path)), path).not.toMatch(/attemptKey:|seedDraft\(|draftFromSet\(|dispatch\(/); // a type like Omit<SetDraft, "attemptKey"> is fine
    }
  });
  it("seedDraft( is called only from setDraft.ts and EntryRow.tsx", () => {
    const callers = Object.entries(workouts).filter(([, src]) => /\bseedDraft\(/.test(stripComments(src))).map(([p]) => p).sort();
    expect(callers).toEqual(["./EntryRow.tsx", "./setDraft.ts"]);
  });
});

describe("17.1 AC39 — (c) the panel's numbers use the signature figure tokens", () => {
  it("NumberStepper and the figure inputs set size, weight and stretch from the figure tokens; nothing overrides numerics", () => {
    for (const path of ["./NumberStepper.module.css", "./SetFields.module.css"]) {
      const css = read(path);
      for (const token of ["--font-size-figure", "--font-weight-figure", "--font-stretch-figure"]) expect(css, path).toContain(`var(${token})`);
    }
    for (const path of ["./NumberStepper.module.css", "./SetFields.module.css", "./EntryRow.module.css", "./ExerciseCard.module.css", "./SessionClock.module.css", "./WorkoutMenu.module.css"]) {
      expect(read(path), path).not.toMatch(/font-variant-numeric/);
    }
  });
});

const SRC = join(here, "..", "..");
const NEW_CSS = ["./NumberStepper.module.css", "./WorkoutMenu.module.css", "./SessionClock.module.css", "../../ui/VisuallyHidden.module.css"];

describe("17.1 AC40 — roles and tokens", () => {
  it("teal in the new and changed workout stylesheets appears only in EntryRow.module.css", () => {
    for (const path of [...NEW_CSS, "./ExerciseCard.module.css", "./SetFields.module.css", "./ActiveSession.module.css"]) {
      expect(read(path), path).not.toMatch(/--color-(signal|on-signal|signal-soft|selected|on-selected)\b/);
    }
    expect(read("./EntryRow.module.css")).toMatch(/--color-signal-soft/);
  });

  it("no brass and no warm-up token in a new file", () => {
    for (const path of NEW_CSS) expect(read(path), path).not.toMatch(/--color-(pr|pr-soft|warmup)\b/);
  });

  it("the steppers' icons are drawn; no ± or ✓ glyph in non-test source", () => {
    const icons = read("../../ui/icons.tsx");
    expect(icons).toMatch(/export function MinusIcon/);
    expect(icons).toMatch(/export function PlusIcon/);
    const files = filesUnder(SRC, /\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f) && !relative(SRC, f).startsWith("test/"));
    const hits = files.filter((f) => /[±✓]/.test(stripComments(readFileSync(f, "utf8")))).map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });

  it("the panel tints, never outlines (17.0 AC12)", () => {
    const css = stylesheets(here).find((s) => s.path.endsWith("EntryRow.module.css"))!.css;
    const rule = css.slice(css.indexOf(".row {"), css.indexOf("}", css.indexOf(".row {")));
    expect(rule).toMatch(/background:\s*var\(--color-signal-soft\)/);
    expect(rule).not.toMatch(/(?:border(?!-radius)[\w-]*|outline[\w-]*)\s*:/); // a radius shapes the tint; it is not an outline
  });
});

describe("17.1 AC24 — 44 px targets", () => {
  it("the ± buttons and number inputs are 3rem; the collapsed row is at least the tap target", () => {
    const stepper = read("./NumberStepper.module.css");
    for (const selector of [".step {", ".input {"]) {
      const at = stepper.indexOf(selector);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      expect(stepper.slice(at, stepper.indexOf("}", at))).toMatch(/min-height:\s*calc\(var\(--space-8\) \+ var\(--space-4\)\)/);
    }
    expect(stepper.slice(stepper.indexOf(".step {"))).toMatch(/min-width:\s*calc\(var\(--space-8\) \+ var\(--space-4\)\)/);
    const card = read("./ExerciseCard.module.css");
    expect(card.slice(card.indexOf(".summary {"))).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    // The Workout menu, its items, "Set options" and the bar button are the shared Button, sized to --tap-target-min.
    expect(read("../../ui/Button.module.css")).toMatch(/--tap-target-min/);
  });
});

const NEW_TS = ["./currentExercise.ts", "./useCurrentExercise.ts", "./summaryLine.ts", "./stepper.ts", "./NumberStepper.tsx", "./logAction.ts", "./LogBarButton.tsx", "./unloggedPlanned.ts", "./WorkoutMenu.tsx", "./EndEarlyDialog.tsx", "./SessionClock.tsx", "../../ui/VisuallyHidden.tsx"];
const all = import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("17.1 AC36 — logout guard and storage rules", () => {
  it("no new file names the browser storage globals (comments included), imports auth, or reports anything", () => {
    for (const path of NEW_TS) {
      const src = read(path);
      expect(src, path).not.toMatch(/localStorage|sessionStorage/);
      expect(stripComments(src), path).not.toMatch(/from ["'][^"']*\/auth\/|\btrack\(|reportError\(|console\./);
    }
  });
  it("useLogoutGuard is still imported by ProfileScreen only", () => {
    const importers = Object.entries(all).filter(([, s]) => /from\s+["'][^"']*useLogoutGuard["']/.test(stripComments(s))).map(([p]) => p);
    expect(importers).toHaveLength(1);
    expect(importers[0]).toMatch(/\/me\/ProfileScreen\.tsx$/);
  });
});

describe("17.1 AC37 — regroup still never carries notes", () => {
  it("useRegroup and the patch type name no notes", () => {
    expect(stripComments(read("./useRegroup.ts"))).not.toMatch(/notes/);
    const client = stripComments(read("./workoutClient.ts"));
    const at = client.indexOf("WorkoutExercisePatch");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(client.slice(at, client.indexOf("}", at))).not.toMatch(/notes/);
  });
});

describe("17.1 AC35 — progress stays positional", () => {
  it("the new pure modules never read setNumber", () => {
    for (const path of ["./currentExercise.ts", "./summaryLine.ts", "./unloggedPlanned.ts"]) expect(stripComments(read(path)), path).not.toMatch(/setNumber/);
  });
});
