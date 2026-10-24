import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guessModality } from "../src/exerciseMatch.js";
import { buildImportPlan } from "../src/importPlan.js";
import { readWorkoutText, type ReadItem } from "../src/workoutText.js";

/** The owner's "Don't Let up" paste: four screenshots, three with an icon after the clock (2026-10-24). */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-24.txt");
const raw = readFileSync(FIXTURE, "utf8");
const rowsOf = (i: ReadItem) => i.rows?.map((r) => [r.repsLow, r.repsHigh]);
const times = (n: number, row: (number | null)[]) => Array.from({ length: n }, () => row);

describe("10.4 AC53 — the 2026-10-24 example, end to end", () => {
  const r = readWorkoutText(raw);

  it("three sections, named from the badge-tagged headers; no routine note", () => {
    expect(r.name).toBe("Don't Let up");
    expect(r.notes).toBe("");
    expect(r.sections.map((s) => s.name)).toEqual(["Warmup", "Don't Let up", "Accessory"]);
  });

  it("Warmup is note-only (D7), without the repeated Warmup line", () =>
    expect(r.sections[0]!.notes.split("\n")).toEqual([
      "Downward dog Calf Stretch", "R/L Pigeon", "Alternating Iron Cross", "into:",
      "3x 30s on / 30s Rest on an Echo Bike", "3x 30s on / 30s Rest on a Runner", "then 1 Round:",
      "5/5 Standing HIP CARS", "10/10 Leg Swings in both Directions",
    ]));

  it("Don't Let up's note holds every other line once, in order", () => {
    const lines = r.sections[1]!.notes.split("\n");
    expect(lines.slice(0, 14)).toEqual([
      "10x 90s on / 90s Rest", "10 Sets, 1 Set Every 3:00", "90s on / 90s Rest", "In a gos Time window,", "Rest 90s and Repeat",
      "Scaled Run:", "150m", "Non- Run", "200m Row + Max Cal Echo bike", "200m Ski + Max Cal Bike", "Outdoor:",
      "200m: Pet supplies plus building (Scaled) Firestone Building", "INTENT", "Today is about speed, power, and repeatable high-intensity efforts.",
    ]);
    expect(lines[14]).toMatch(/^Push the 200m Run/);
    expect(lines[15]).toMatch(/^The 90 seconds of rest/);
    expect(lines.slice(16)).toEqual([
      "AT HOME or ON THE ROAD", "(No Bike)", "10 SETS", "1:30 on / 1:30 REst", "200 m Run or Row", "M ax Burpees with remaining Time",
      "(No run no machine)", "1:30 on / 1:30 Rest", "30 Air Squats", "max Burpees with remaining Time",
    ]);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("six exercises: two in the workout, four in Accessory, each block one run", () => {
    expect(r.items.map((i) => [i.name, i.section, rowsOf(i)])).toEqual([
      ["200 Meter Run", 1, times(10, [null, null])],
      ["Echo Bike", 1, times(10, [null, null])],
      ["Double DB Bench Press", 2, times(3, [10, 15])],
      ["DB or Plate Front Raises", 2, times(3, [15, 15])],
      ["Tuckups", 2, times(3, [10, 10])],
      ["Hollow Rocks", 2, times(3, [15, 15])],
    ]);
    expect(r.items[0]!.noteLines).toEqual(["200 Meter"]);
    expect(r.items[1]!.noteLines).toEqual(["Max Cal, with remaining time"]);
    expect(r.sections[2]!.notes).toBe("3 Sets, 1 Set Every 4:00");
  });

  it("the plan: 3 sections, two supersets, nothing left out", () => {
    const plan = buildImportPlan(r, (k) => guessModality(k));
    expect(plan.sections.map((s) => s.name)).toEqual(["Warmup", "Don't Let up", "Accessory"]);
    expect(plan.items.map((i) => i.supersetGroup)).toEqual([1, 1, 2, 2, 2, 2]);
    expect(plan.notices.map((n) => n.code)).not.toContain("sections-left-out");
    expect(plan.notices.map((n) => n.code)).not.toContain("items-left-out");
  });
});
