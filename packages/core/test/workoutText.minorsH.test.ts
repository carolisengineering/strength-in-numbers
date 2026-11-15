import { describe, expect, it } from "vitest";
import { readWorkoutText } from "../src/workoutText.js";

const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

describe("10.4 AC69 — minor 562: a sets line's run closes at a label (owner decision 2026-11-14)", () => {
  it("Bench Press / 4 Sets / AMRAP 10: / 10 Burpees → Burpees never takes the 4 sets; both lines stay in the note", () => {
    const r = read(["Bench Press", "4 Sets", "AMRAP 10:", "10 Burpees"]);
    expect(r.items.map((i) => i.name)).toEqual(["Burpees"]);
    // An AC62 counted line in a block of its own (rowless), not a 4-round member of the sets run.
    expect(r.items[0]!.rows).toBeNull();
    expect(r.sections[0]!.notes).toBe("4 Sets\nAMRAP 10:");
  });

  it("a range and an AC48 sets lead-in close at a label too", () => {
    const range = read(["Main", "3-4 Sets", "Time cap: 12:00", "10 Burpees", "10 Push-ups"]);
    expect(range.items.map((i) => i.rows)).toEqual([null, null]);
    const every = read(["Main", "4 Sets, 1 Set Every 2:00", "AMRAP 10:", "10 Burpees"]);
    expect(every.items.map((i) => i.rows)).toEqual([null]);
  });

  it("Review Focus 2: a scheme or rounds lead-in still keeps its run open through a label (AC69 as it stands)", () => {
    const scheme = read(["Main", "21-15-9", "Time cap: 12:00", "Thrusters", "Pull-ups"]);
    expect(scheme.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(new Set(scheme.items.map((i) => i.run)).size).toBe(1);
    const rounds = read(["Main", "3 Rounds", "AMRAP 12:", "10 Burpees", "10 Push-ups"]);
    expect(rounds.items.map((i) => i.rows?.length)).toEqual([3, 3]);
    expect(new Set(rounds.items.map((i) => i.run)).size).toBe(1);
  });

  it("a sets run that already has a movement closes at a label, as before", () => {
    const r = read(["Main", "4 Sets", "Bench Press", "AMRAP 10:", "10 Burpees"]);
    expect(r.items.map((i) => [i.name, i.rows?.length ?? null])).toEqual([
      ["Bench Press", 4],
      ["Burpees", null],
    ]);
  });
});

describe("10.4 AC71 — minor 563: markdown bold around a bulleted movement comes off", () => {
  it("* **10 Squats** and - __10 Squats__ read as Squats with 10 reps", () => {
    for (const line of ["* **10 Squats**", "- __10 Squats__"]) {
      const r = read(["Main", line]);
      expect(r.items.map((i) => [i.name, i.repsText]), line).toEqual([["Squats", "10"]]);
    }
  });

  it("under a run, a bold bulleted movement takes the run's sets", () => {
    const r = read(["Main", "3 Sets", "* **10 Squats**", "- __10 Lunges__"]);
    expect(r.items.map((i) => [i.name, i.rows?.length])).toEqual([
      ["Squats", 3],
      ["Lunges", 3],
    ]);
  });

  it("• **Bench Press** under a run reads as Bench Press", () => {
    const r = read(["Main", "4 Sets", "• **Bench Press**"]);
    expect(r.items.map((i) => i.name)).toEqual(["Bench Press"]);
  });

  it("Review Focus 1: a bold line that isn't a bulleted movement reads as on main", () => {
    // Captured from the reader on main (c015a3b3): both lines are the section's note, and nothing is an item.
    const r = read(["Main", "**Warm-up**", "**Note:** rest 2 min"]);
    expect(r.items).toEqual([]);
    expect(r.sections[0]!.notes).toBe("**Warm-up**\n**Note:** rest 2 min");
  });
});
