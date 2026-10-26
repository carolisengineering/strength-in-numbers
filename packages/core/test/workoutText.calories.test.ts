import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guessModality, matchExerciseName } from "../src/exerciseMatch.js";
import { buildImportPlan } from "../src/importPlan.js";
import { readWorkoutText, type ReadItem } from "../src/workoutText.js";

const read = (lines: string[]) => readWorkoutText(lines.join("\n"));
const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8");
/** The parts of an item a lifter sees, plus the hint. */
const view = (i: ReadItem) => ({
  name: i.name,
  noteLines: i.noteLines,
  rows: i.rows?.map((r) => [r.repsLow, r.repsHigh]) ?? null,
  quickReps: i.quickReps,
  repsText: i.repsText,
  calories: i.calories,
});
const NULL_ROWS = [[null, null], [null, null], [null, null]];

describe("05.3 AC34 — Max Cal sets the calories hint", () => {
  it.each([
    ["Max Cal Echo Bike with remaining time", "Echo Bike"],
    ["Max Calories Row", "Row"],
  ])("%s → %s, calories: true", (line, name) => {
    const r = read(["3 Sets:", line]);
    expect(r.items[0]).toMatchObject({ name, calories: true });
    expect(r.names[0]).toMatchObject({ written: name, calories: true });
  });
  it.each([
    ["Max Reps Pull-ups", "Pull-ups"],
    ["Max Burpees", "Burpees"],
  ])("%s → %s, calories: false", (line, name) => {
    const r = read(["3 Sets:", line]);
    expect(r.items[0]).toMatchObject({ name, calories: false });
    expect(r.names[0]!.calories).toBe(false);
  });
  it("a bullet Max Cal line sets it too", () => expect(read(["- Max Cal Row"]).items[0]).toMatchObject({ name: "Row", calories: true }));
  it("a name read once with and once without the form is a calories name", () => {
    const r = read(["3 Sets:", "10 Row", "Max Cal Row"]);
    expect(r.items.map((i) => i.calories)).toEqual([false, true]);
    expect(r.names).toEqual([expect.objectContaining({ written: "Row", calories: true })]);
  });
});

describe("05.3 AC34 — guessModality's hint", () => {
  it.each(["Echo Bike", "Row", "400m Row", "Bike Erg", "Run"])("%s with { calories: true } is calories", (name) =>
    expect(guessModality(name, { calories: true })).toBe("calories"));
  it("no hint, or calories: false, is today's guess", () => {
    expect(guessModality("Echo Bike")).toBe("distance_duration");
    expect(guessModality("Echo Bike", {})).toBe("distance_duration");
    expect(guessModality("Echo Bike", { calories: false })).toBe("distance_duration");
    expect(guessModality("Row")).toBe("weight_reps");
  });
});

describe("05.3 AC34 — the import plan refuses reps for the new types", () => {
  it.each(["calories", "weight_distance", "weight_duration"] as const)("%s: reps go to the note, no weight", (m) => {
    const p = buildImportPlan(readWorkoutText(["Engine", "3 Sets:", "10 Row", "x."].join("\n")), () => m);
    expect(p.items[0]).toMatchObject({ form: { kind: "quick", targetSets: 3, targetRepsLow: null, targetRepsHigh: null }, notes: "10 reps as written" });
    expect(JSON.stringify(p.items[0])).not.toMatch(/weight/i);
  });
});

describe("05.3 AC36 — leading calorie lines", () => {
  it.each([
    ["20 Cal Row", "Row", "20 Cal"],
    ["15 Cals Ski Erg", "Ski Erg", "15 Cals"],
    ["12 Calories Echo Bike", "Echo Bike", "12 Calories"],
    ["20cal Row", "Row", "20cal"],
    ["20 CAL row", "row", "20 CAL"],
    ["9999 Calorie Bike", "Bike", "9999 Calorie"],
  ])("under a run: %s → %s, note %s", (line, name, note) => {
    const r = read(["3 Sets:", line]);
    expect(r.items.map(view)).toEqual([{ name, noteLines: [note], rows: NULL_ROWS, quickReps: null, repsText: null, calories: true }]);
    expect(r.names).toEqual([expect.objectContaining({ written: name, calories: true })]);
  });
  it.each([
    ["20 Cal Row", "Row", "20 Cal"],
    ["15 Cals Ski Erg", "Ski Erg", "15 Cals"],
    ["12 Calories Echo Bike", "Echo Bike", "12 Calories"],
    ["20cal Row", "Row", "20cal"],
  ])("as a bare bullet: - %s → rowless %s, note %s", (line, name, note) => {
    const r = read([`- ${line}`]);
    expect(r.items.map(view)).toEqual([{ name, noteLines: [note], rows: null, quickReps: null, repsText: null, calories: true }]);
  });
  it("as a bullet under a run it is a run movement", () =>
    expect(read(["3 Sets:", "- 20 Cal Row"]).items.map(view)).toEqual([
      { name: "Row", noteLines: ["20 Cal"], rows: NULL_ROWS, quickReps: null, repsText: null, calories: true },
    ]));
  it("Review Focus 5 — 20 Cals Row is now a calorie line, not 20 reps of Cals Row", () => {
    expect(read(["3 Sets:", "20 Cals Row"]).items.map(view)).toEqual([
      { name: "Row", noteLines: ["20 Cals"], rows: NULL_ROWS, quickReps: null, repsText: null, calories: true },
    ]);
    expect(read(["- 20 Cals Row"]).items.map(view)).toEqual([{ name: "Row", noteLines: ["20 Cals"], rows: null, quickReps: null, repsText: null, calories: true }]);
  });
  it("five digits is not a calorie line", () => expect(read(["3 Sets:", "12345 Cal Row"]).items[0]!.calories).toBe(false));
});

/**
 * Each line read on main (998c69d) before this change, under `3 Sets:` and as a `- ` bullet. A bullet with
 * no item went to the routine note. The only difference now is `calories: false` on every item.
 */
describe("05.3 AC37 — leading-calorie non-matches read as today", () => {
  const row = (name: string, noteLines: string[], rows: (number | null)[][], repsText: string | null) => ({
    name, noteLines, rows, quickReps: null, repsText, calories: false,
  });
  const reps = (n: number) => [[n, n], [n, n], [n, n]];
  it.each<[string, ReturnType<typeof row>[], ReturnType<typeof view>[]]>([
    ["20 Row", [row("Row", [], reps(20), "20")], [{ name: "Row", noteLines: [], rows: null, quickReps: { repsLow: 20, repsHigh: 20 }, repsText: "20", calories: false }]],
    ["20 Cal", [row("20 Cal", ["20 Cal"], NULL_ROWS, null)], []],
    ["Cal Ripken Drill", [row("Cal Ripken Drill", [], NULL_ROWS, null)], []],
    ["Row 20 Cal", [row("Row 20 Cal", [], NULL_ROWS, null)], []],
    ["10-15 Cal Row", [row("10-15 Cal Row", [], NULL_ROWS, null)], []],
    ["20 Cal Row + 15 Burpees", [row("20 Cal Row + 15 Burpees", ["20 Cal"], NULL_ROWS, null)], []],
    ["200 Meter Run", [row("200 Meter Run", ["200 Meter"], NULL_ROWS, null)], []],
    ["2 Min Plank", [row("2 Min Plank", ["2 Min"], NULL_ROWS, null)], []],
    ["20 Calf Raises", [row("Calf Raises", [], reps(20), "20")], [{ name: "Calf Raises", noteLines: [], rows: null, quickReps: { repsLow: 20, repsHigh: 20 }, repsText: "20", calories: false }]],
  ])("%s", (line, underRun, asBullet) => {
    expect(read(["3 Sets:", line]).items.map(view)).toEqual(underRun);
    const b = read([`- ${line}`]);
    expect(b.items.map(view)).toEqual(asBullet);
    if (asBullet.length === 0) expect(b.notes).toBe(`- ${line}`);
    expect(b.names.every((n) => !n.calories)).toBe(true);
  });
});

describe("05.3 AC41 — feet in the reader", () => {
  it("100 ft Farmer Carry reads like 400 Meter Run: the measure stays in the name and the note", () => {
    expect(read(["3 Sets:", "100 ft Farmer Carry"]).items.map(view)).toEqual([
      { name: "100 ft Farmer Carry", noteLines: ["100 ft"], rows: NULL_ROWS, quickReps: null, repsText: null, calories: false },
    ]);
    const bullet = read(["- 100 ft Farmer Carry"]);
    expect(bullet.items).toEqual([]);
    expect(bullet.notes).toBe("- 100 ft Farmer Carry");
  });
  it.each(["100 ft Farmer Carry", "100ft Sled Push"])("guessModality(%s) is distance_duration", (name) =>
    expect(guessModality(name)).toBe("distance_duration"));
  it("the match key drops a bare ft like m: a name of only numbers and ft has no tokens", () => {
    // Were ft a token, "100 ft" would score 1.25 against a row named "Ft" and match it as similar.
    expect(matchExerciseName("400 m", [{ id: "1", name: "M", ownerUserId: null }])).toEqual({ kind: "none" });
    expect(matchExerciseName("100 ft", [{ id: "1", name: "Ft", ownerUserId: null }])).toEqual({ kind: "none" });
  });
  it.each([
    ["Rear Foot Elevated Split Squat", "weight_reps"],
    ["Feet Elevated Push-up", "bodyweight_reps"],
  ])("%s reads and guesses as on main (feet / foot are not unit words)", (name, m) => {
    expect(read(["3 Sets:", name]).items.map(view)).toEqual([{ name, noteLines: [], rows: NULL_ROWS, quickReps: null, repsText: null, calories: false }]);
    expect(guessModality(name)).toBe(m);
  });
});

describe("05.3 AC38 — both fixtures: only Echo Bike from Max Cal is a calories name", () => {
  it("hiraya-2026-10-24", () => {
    const r = readWorkoutText(fixture("hiraya-2026-10-24.txt"));
    expect(r.names.filter((n) => n.calories).map((n) => n.written)).toEqual(["Echo Bike"]);
    expect(r.items.filter((i) => i.calories).every((i) => i.name === "Echo Bike" && i.noteLines.some((l) => /^Max Cal/.test(l)))).toBe(true);
  });
  it("hiraya-2026-10-19 has no calories name", () => {
    const r = readWorkoutText(fixture("hiraya-2026-10-19.txt"));
    expect(r.names.length).toBeGreaterThan(0);
    expect(r.names.every((n) => n.calories === false)).toBe(true);
    expect(r.items.every((i) => i.calories === false)).toBe(true);
  });
});
