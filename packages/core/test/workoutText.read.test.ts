import { describe, expect, it } from "vitest";
import { readWorkoutText } from "../src/workoutText.js";

const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

describe("10.4 AC5 — headings make sections", () => {
  it.each([
    ['Workout: "Second Shift"', "Second Shift"], ['Workout: " Second Shift"', "Second Shift"], ["workout: “Engine”", "Engine"],
    ["Strength", "Strength"], ["Accessories", "Accessories"], ["Cool down", "Cool down"], ["Accessory:", "Accessory"],
    ["Strict Press", "Strict Press"], ["STRICT PRESS", "STRICT PRESS"], ["Front Rack Carry", "Front Rack Carry"],
  ])("%s → section %s", (line, name) => expect(read([line, "a note."]).sections[0]?.name).toBe(name));
  it.each(["Heavy 10", "For Time:", "Push the pace.", "Hello, world", "Strict press with pause and tempo now", "strict press", 'Workout: ""', "- Strict Press", "x"])
    ("%s is not a heading", (line) => expect(read([line, "a note."]).sections).toEqual([]));
  it("not the last line", () => expect(read(["intro.", "Strict Press"]).sections).toEqual([]));
  it.todo("no generic title while a movement list is open");
  it.skip("no generic title while a movement list is open (Task 4)", () => {
    const r = read(["Engine", "21-15-9", "Power Clean", "Thrusters"]);
    expect(r.sections.map((s) => s.name)).toEqual(["Engine"]);
    expect(r.items.map((i) => i.name)).toEqual(["Power Clean", "Thrusters"]);
  });
  it("known words still head a section while a list is open", () => expect(read(["Engine", "3 Sets:", "10 Curl", "Accessory", "x."]).sections).toHaveLength(2));
});

describe("10.4 AC6 — Warmup is note-only", () => {
  it.each(["Warmup", "warm-up", "WARM UP"])("%s", (h) => {
    const r = read([h, "400m easy Run", "then 2 Rounds", "- 10 Arm Circles", "21-15-9", "Strict Press", "x."]);
    expect(r.sections[0]).toEqual({ name: h, notes: "400m easy Run\nthen 2 Rounds\n- 10 Arm Circles\n21-15-9", warmup: true });
    expect(r.items).toEqual([]);
  });
});

describe("10.4 AC13 — routine name and preamble", () => {
  it("the first Workout title wins", () => expect(read(["Warmup", "x", "Strength", "y", 'Workout: "Engine"', "z."]).name).toBe("Engine"));
  it("else the first non-Warmup heading", () => expect(read(["Warmup", "x", "Strength", "y."]).name).toBe("Strength"));
  it("else null", () => expect(read(["just text.", "more."]).name).toBeNull());
  it("preamble lines become the routine note", () => expect(read(["Coach says hi.", "Strength", "x."]).notes).toBe("Coach says hi."));
  it.todo("preamble bullets are loose items");
  it("set lines before any heading are notes (no title to name the exercise)", () => expect(read(["Set 1: 5 Reps", "Strength", "x."]).notes).toBe("Set 1: 5 Reps"));
});
