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
  "features/exercises/RecordsView.module.css",
  "features/progress/ExerciseProgressBody.module.css",
  "features/routines/UnitToggle.module.css",
  "features/routines/RoutinesSection.module.css",
  // Issue #98: the shared "‹ Back to …" text link (interactive), as on FinishedWorkoutScreen.
  "ui/BackLink.module.css",
  "features/routines/SupersetBracket.module.css",
  "features/catalog/ExercisePicker.module.css",
  "features/catalog/CreateExerciseForm.module.css",
  // Spec 10.4 D13: the create-exercise fields moved into ExerciseFields (the checked choice is a selection).
  "features/catalog/ExerciseFields.module.css",
  // Spec 10.4 AC28: "Go to the first one" beside a disabled Continue is an interactive text link.
  "features/routines/import/ImportNames.module.css",
  "features/history/HistoryScreen.module.css",
  "features/workouts/FinishedWorkoutScreen.module.css",
  "features/workouts/RestLine.module.css",
  // Spec 17.1 D12: the current-set panel (signal-soft ground, teal set label) is the "do this next" surface.
  "features/workouts/EntryRow.module.css",
  "features/me/ThemeSetting.module.css",
  // #108: the checked "Keep screen on during workouts" box is a selection, like Theme beside it.
  "features/me/KeepAwakeSetting.module.css",
  // Spec 20.2 AC23: the checked auto-push box is a selection, like Keep screen on.
  "features/hevy/AutoPushSetting.module.css",
];
// Spec 17.2 AC35: the record cards join the records block and the History badge.
const PR_ALLOWED = ["features/records/PersonalRecordsBlock.module.css", "features/records/RecordCardList.module.css", "features/history/HistoryScreen.module.css"];
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
    ["features/records/RecordCardList.module.css", ".card"],
    ["features/history/HistoryScreen.module.css", ".row"],
    ["features/workouts/RoutineNotePanel.module.css", ".panel"],
    ["features/exercises/RecordsView.module.css", ".row"],
    ["features/progress/ExerciseProgressBody.module.css", ".session"],
    ["features/routines/RoutinesSection.module.css", ".row"],
    ["features/routines/RoutineEditor.module.css", ".card"],
    ["features/workouts/FinishedWorkoutScreen.module.css", ".exercise"],
    ["ui/ConfirmDialog.module.css", ".dialog"],
    ["features/workouts/EntryRow.module.css", ".row"],
    ["features/workouts/edit/EditWorkoutScreen.module.css", ".banner"],
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

describe("17.1 AC40 — the current-set panel is the one new teal use", () => {
  it("EntryRow.module.css is allow-listed and on the tint-not-outline list", () => {
    expect(SIGNAL_ALLOWED).toContain("features/workouts/EntryRow.module.css");
    expect(users(/--color-(signal|on-signal|signal-soft|selected|on-selected)\b/)).toContain("features/workouts/EntryRow.module.css");
  });
});

describe("18.0 AC45 — no brass on the edit screen", () => {
  it("no stylesheet under features/workouts/edit names --color-pr", () => {
    const edit = sheets.filter((s) => s.path.startsWith("features/workouts/edit/"));
    expect(edit.length).toBeGreaterThan(0);
    expect(edit.filter((s) => /--color-pr\b|--color-pr-soft/.test(s.css)).map((s) => s.path)).toEqual([]);
  });
});

describe("18.0 AC45 — Change Time styles", () => {
  it("the sheet and the changed headers use neither brass nor teal", () => {
    const changed = [
      "features/workouts/changeTime/ChangeTimeSheet.module.css",
      "features/workouts/ActiveSession.module.css",
      "features/workouts/WorkoutMenu.module.css",
      "features/workouts/edit/EditWorkoutScreen.module.css",
    ];
    const found = sheets.filter((s) => changed.includes(s.path));
    expect(found.map((s) => s.path).sort()).toEqual([...changed].sort());
    expect(found.filter((s) => /--color-pr\b|--color-pr-|--color-signal/.test(s.css)).map((s) => s.path)).toEqual([]);
  });
});
