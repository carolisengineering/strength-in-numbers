import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stylesheets } from "../test/sourceScan";

// Spec 17.0 §6.2–§6.6: each color role means one thing, and panels separate by tint, not outline.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheets = stylesheets(SRC)
  .filter((s) => !s.path.endsWith("tokens.css"))
  .map((s) => ({ path: relative(SRC, s.path), css: s.css }));
const users = (pattern: RegExp) => sheets.filter((s) => pattern.test(s.css)).map((s) => s.path).sort();

// A later spec that adds a use edits the list in the same change and justifies it in its §12.
const SIGNAL_ALLOWED = [
  "ui/reset.css",
  "ui/Button.module.css",
  "app/AppShell.module.css",
  "features/progress/ChoiceGroup.module.css",
  "features/progress/LineChart.module.css",
  "features/progress/ProgressScreen.module.css",
  "features/progress/ExerciseProgressScreen.module.css",
  "features/routines/UnitToggle.module.css",
  "features/routines/RoutinesSection.module.css",
  "features/routines/SupersetBracket.module.css",
  "features/catalog/ExercisePicker.module.css",
  "features/catalog/CreateExerciseForm.module.css",
  "features/history/HistoryScreen.module.css",
  "features/workouts/FinishedWorkoutScreen.module.css",
  "features/me/ThemeSetting.module.css",
];
const PR_ALLOWED = ["features/records/PersonalRecordsBlock.module.css", "features/history/HistoryScreen.module.css"];
const WARMUP_ALLOWED = ["features/workouts/ExerciseCard.module.css", "features/workouts/FinishedWorkoutScreen.module.css"];

describe("AC6 — color roles stay single-meaning", () => {
  it("uses brass only on records", () => {
    expect(PR_ALLOWED).toEqual(expect.arrayContaining(users(/--color-pr(-soft)?\b/)));
  });

  it("uses the warm-up color only on set rows", () => {
    expect(WARMUP_ALLOWED).toEqual(expect.arrayContaining(users(/--color-warmup\b/)));
  });

  it("uses teal (signal, selection) only where the spec allows it", () => {
    expect(SIGNAL_ALLOWED).toEqual(expect.arrayContaining(users(/--color-(signal|on-signal|signal-soft|selected|on-selected)\b/)));
  });

  // The focus ring is teal too, but any focusable control may draw one, so --color-focus is free to use.
  it("draws focus only as an outline", () => {
    for (const s of sheets.filter((x) => /--color-focus\b/.test(x.css))) {
      const props = [...s.css.matchAll(/^\s*([\w-]+)\s*:[^;\n]*--color-focus/gm)].map((m) => m[1]);
      expect(props.every((p) => /^(outline|outline-color|box-shadow)$/.test(p!))).toBe(true);
    }
  });

  it("never lets a brass file double as a non-record teal surface outside the history list", () => {
    for (const path of PR_ALLOWED.filter((p) => p !== "features/history/HistoryScreen.module.css")) {
      expect(sheets.find((s) => s.path === path)?.css ?? "").not.toMatch(/--color-(signal|selected)\b/);
    }
  });
});

describe("AC12 — panels separate by tint, not outline", () => {
  const PANELS: Array<[string, string]> = [
    ["features/workouts/ExerciseCard.module.css", ".card"],
    ["features/records/PersonalRecordsBlock.module.css", ".block"],
    ["features/history/HistoryScreen.module.css", ".row"],
    ["features/workouts/RoutineNotePanel.module.css", ".panel"],
    ["features/progress/ProgressScreen.module.css", ".row"],
    ["features/progress/ExerciseProgressScreen.module.css", ".session"],
    ["features/routines/RoutinesSection.module.css", ".row"],
    ["features/routines/RoutineEditor.module.css", ".card"],
    ["features/workouts/FinishedWorkoutScreen.module.css", ".exercise"],
    ["ui/ConfirmDialog.module.css", ".dialog"],
  ];

  it.each(PANELS)("%s %s has no control outline", (path, selector) => {
    const css = sheets.find((s) => s.path === path)!.css;
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).not.toMatch(/border[\w-]*\s*:[^;]*--color-border/);
  });

  it("keeps a 3:1 control outline on form fields and secondary buttons", () => {
    expect(sheets.find((s) => s.path === "ui/Field.module.css")!.css).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(sheets.find((s) => s.path === "ui/Button.module.css")!.css).toMatch(/\.secondary\s*\{[^}]*border-color:\s*var\(--color-border\)/);
  });
});
