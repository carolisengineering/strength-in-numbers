import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guessModality } from "../src/exerciseMatch.js";
import { buildImportPlan } from "../src/importPlan.js";
import { readWorkoutText, type ReadItem } from "../src/workoutText.js";

/** The owner's "MORRO BAY" paste: five screenshots on cellular with the phone muted (2026-10-26). */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-26.txt");
const raw = readFileSync(FIXTURE, "utf8");
const rowsOf = (i: ReadItem) => i.rows?.map((r) => [r.repsLow, r.repsHigh]);
const times = (n: number, row: (number | null)[]) => Array.from({ length: n }, () => row);

describe("10.4 AC64 — the 2026-10-26 example, end to end", () => {
  const r = readWorkoutText(raw);

  it("5 screenshots, 4 sections, routine name MORRO BAY, no routine note", () => {
    expect(r.chunks).toBe(5);
    expect(r.name).toBe("MORRO BAY");
    expect(r.notes).toBe("");
    expect(r.sections.map((s) => s.name)).toEqual(["Warmup", "Back Squat - Deload", "MORRO BAY", "Accessory"]);
  });

  it("no furniture and no line twice in any note (Review Focus 5)", () => {
    for (const s of r.sections) {
      const lines = s.notes.split("\n");
      expect(new Set(lines).size).toBe(lines.length);
      for (const junk of [/LTE/, /^Y'$/, /^只'$/, /^3 \+ 0$/, /^5 @ 130 Lbs$/, /^ROUNDS\/REPS$/, /^(?:€ )?\d{1,2}:\d{2}(?:\d| A)?$/]) {
        expect(lines.some((l) => junk.test(l))).toBe(false);
      }
    }
  });

  it("Warmup is note-only (D7)", () => {
    const lines = r.sections[0]!.notes.split("\n");
    expect([lines[0], lines.at(-1), lines.length]).toEqual(["250/200m Row", "5:00 to Build to Working Weight", 13]);
  });

  it("section notes", () => {
    const squat = r.sections[1]!.notes.split("\n");
    expect(squat.slice(0, 6)).toEqual([
      "4x5 @ 60%", "BACK SQUAT - DELOAD", "4 Sets, 1 Set Every 4:00", "*All sets, same weight across*", "Accessory Between Sets:", "Score: weight lifted for 4 sets.",
    ]);
    expect(squat).toHaveLength(11);
    const morro = r.sections[2]!.notes.split("\n");
    expect(morro.slice(0, 4)).toEqual(["AMRAP 15", "Score: Total rounds + reps.", "Run= 1", "ROW = 1"]);
    expect(morro.filter((l) => l === "INTENT")).toHaveLength(1);
    expect(morro.at(-1)).toMatch(/^The 18 reps are intentional/);
    expect(r.sections[3]!.notes).toBe("3-4 Sets");
  });

  it("nine exercises in three runs", () => {
    expect(r.items.map((i) => [i.name, i.section, rowsOf(i), i.quickReps && [i.quickReps.repsLow, i.quickReps.repsHigh], i.noteLines])).toEqual([
      ["Back Squats", 1, times(4, [5, 5]), null, ["@ 60-65% of IRM"]],
      ["TOES elevated DB Romanian deadlifts", 1, times(4, [10, 10]), null, []],
      ["Landmine twists", 1, times(4, [16, 16]), null, []],
      ["250/200m Row", 2, undefined, null, ["250/200m"]],
      ["Alternating Double DB Reverse Lunges", 2, undefined, [18, 18], []],
      ["200 Meter Run", 2, undefined, null, ["200 Meter"]],
      ["Double DB Alternating Strict Press", 2, undefined, [18, 18], []],
      ["Weighted Cossak Squats (Goblet)", 3, times(3, [12, 12]), null, []],
      ["KB Windmill", 3, times(3, [10, 10]), null, ["5/5"]],
    ]);
  });

  it("the plan: three supersets, no notice", () => {
    const plan = buildImportPlan(r, (k) => guessModality(k));
    expect(plan.items.map((i) => i.supersetGroup)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(plan.notices).toEqual([]);
  });

  it("AC12 conservation holds", () => expect(r.lines.furniture + r.lines.overlap + r.lines.placed.length).toBe(r.lines.input));
});
