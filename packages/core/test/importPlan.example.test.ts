import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guessModality, normalizeExerciseName } from "../src/exerciseMatch.js";
import { buildImportPlan, type ImportPlan, type ImportPlanForm, type ImportPlanItem } from "../src/importPlan.js";
import { collapseLine, readWorkoutText } from "../src/workoutText.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-19.txt");
const L = readFileSync(FIXTURE, "utf8").split("\n").map(collapseLine).filter((l) => l !== "");
const between = (a: string, b: string) => L.slice(L.indexOf(a), L.indexOf(b) + 1);
const para = (p: string) => L.find((l) => l.startsWith(p))!;
const item = (name: string, section: number, group: number | null, notes: string | null, form: ImportPlanForm): ImportPlanItem =>
  ({ nameKey: normalizeExerciseName(name), name, section, supersetGroup: group, notes, form });
const planRows = (...n: number[]): ImportPlanForm => ({ kind: "plan", rows: n.map((r) => ({ repsLow: r, repsHigh: r })) });
const quick = (s: number, lo: number | null, hi: number | null): ImportPlanForm => ({ kind: "quick", targetSets: s, targetRepsLow: lo, targetRepsHigh: hi });

const SECOND_SHIFT_NOTE = ["20 Minute Cap", "For Time:", "LV1: 45/35, Hang Power Cleans", "LV2: 75/55", "LV3: 95/65",
  para("Coming off our 10RM"), para("The first 21-15-9"), para("The second half"), para("Manage your effort")].join("\n");
const STRICT_NOTE = ["Heavy 10", "STRICT PRESS — BUILD TO A 10RM", "6 Sets, 1 Set Every 2:00", "Score: Heaviest successful set of 10 reps.",
  para("Today we're building"), para("The percentages"), para("You can attempt"), para("If you complete"), para("Be smart")].join("\n");
const EXPECTED: ImportPlan = {
  name: "Second Shift", notes: null, notices: [],
  sections: [
    { name: "Warmup", notes: between("400m easy Run or 2:00 Machine Choice", "5 Minutes to build to first strict press weight (build by 3-5 reps)").join("\n") },
    { name: "Strict Press", notes: STRICT_NOTE }, { name: "Second Shift", notes: SECOND_SHIFT_NOTE }, { name: "Accessory", notes: null },
  ],
  items: [
    item("Strict Press", 1, null, "Set 1 @ 45–50%\nSet 2 @ 55–60%\nSet 3 @ 60–65%\nSet 4 @ 65–70%\nSet 5 @ 70–75%\nSet 6 @ Build If Able", planRows(6, 6, 4, 4, 10, 10)),
    item("Power Clean", 2, 1, null, planRows(21, 15, 9)),
    item("Hand Release Pushups", 2, 1, null, planRows(21, 15, 9)),
    item("Push Press", 2, 2, null, planRows(21, 15, 9)),
    item("400 Meter Run", 2, 2, "400 Meter\n21-15-9 reps as written", quick(3, null, null)),
    item("Front Raise", 3, 3, null, quick(3, 10, 10)),
    item("Reverse Fly", 3, 3, null, quick(3, 10, 15)),
    item("DB Lateral Lunge", 3, 3, "10/10", quick(3, 20, 20)),
  ],
};

describe("10.4 AC18 — the example, end to end", () => {
  const read = readWorkoutText(readFileSync(FIXTURE, "utf8"));
  // Phase B guesses from the card's written name, never from the key ("400meterrun" has lost its word breaks).
  const guessed = (k: string) => guessModality(read.names.find((n) => n.key === k)!.written);
  it("default guessed modalities give exactly the §6.9 plan", () => {
    expect(EXPECTED.sections[0]!.notes!.split("\n")).toHaveLength(15);
    expect(buildImportPlan(read, guessed)).toEqual(EXPECTED);
    expect(read.names.map((n) => n.written)).toEqual(["Strict Press", "Power Clean", "Hand Release Pushups", "Push Press", "400 Meter Run", "Front Raise", "Reverse Fly", "DB Lateral Lunge"]);
    expect(read.chunks).toBe(5);
  });
  it("Treadmill run and Overhead press as the matches give the same plan", () => {
    const chosen = new Map([[normalizeExerciseName("400 Meter Run"), "distance_duration" as const], [normalizeExerciseName("Strict Press"), "weight_reps" as const]]);
    expect(buildImportPlan(read, (k) => chosen.get(k) ?? guessed(k))).toEqual(EXPECTED);
  });
  it("Hand Release Pushups forced to duration: 3 rows, no reps, scheme in the note", () => {
    const key = normalizeExerciseName("Hand Release Pushups");
    const p = buildImportPlan(read, (k) => (k === key ? "duration" : guessed(k)));
    expect(p.items[2]).toEqual(item("Hand Release Pushups", 2, 1, "21-15-9 reps as written", quick(3, null, null)));
  });
});

describe("10.4 AC54 — the 2026-10-19 example reads as before the 2026-10-24 amendment", () => {
  it("the same four sections and eight exercises, every line placed as before", () => {
    const read = readWorkoutText(readFileSync(FIXTURE, "utf8"));
    expect(read.sections.map((s) => s.name)).toEqual(["Warmup", "Strict Press", "Second Shift", "Accessory"]);
    expect(read.items).toHaveLength(8);
    const count = (as: string) => read.lines.placed.filter((p) => p.as === as).length;
    expect([count("heading"), count("set-line"), count("scheme"), count("lead-in"), count("separator"), count("movement"), count("note")]).toEqual([4, 6, 2, 1, 1, 7, 33]);
  });
});
