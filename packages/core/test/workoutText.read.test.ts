import { describe, expect, it } from "vitest";
import { readWorkoutText, type ReadItem } from "../src/workoutText.js";

const read = (lines: string[]) => readWorkoutText(lines.join("\n"));
const rowsOf = (i: ReadItem) => i.rows?.map((r) => [r.repsLow, r.repsHigh]);

describe("10.4 AC5 — headings make sections", () => {
  it.each([
    ['Workout: "Second Shift"', "Second Shift"], ['Workout: " Second Shift"', "Second Shift"], ["workout: “Engine”", "Engine"],
    ["Strength", "Strength"], ["Accessories", "Accessories"], ["Cool down", "Cool down"], ["Accessory:", "Accessory"],
    ["Strict Press", "Strict Press"], ["STRICT PRESS", "STRICT PRESS"], ["Front Rack Carry", "Front Rack Carry"],
  ])("%s → section %s", (line, name) => expect(read([line, "a note."]).sections[0]?.name).toBe(name));
  it.each(["Heavy 10", "For Time:", "Push the pace.", "Hello, world", "Strict press with pause and tempo now", "strict press", 'Workout: ""', 'Workout: " "', 'Workout: "\t"', "- Strict Press", "x"])("%s is not a heading", (line) => expect(read([line, "a note."]).sections).toEqual([]));
  it("not the last line", () => expect(read(["intro.", "Strict Press"]).sections).toEqual([]));
  it("no generic title while a movement list is open", () => {
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
  it("preamble bullets are loose items", () => {
    const r = read(["Coach says hi.", "- 10 Push-ups", "Strength", "x."]);
    expect(r.notes).toBe("Coach says hi.");
    expect(r.items).toMatchObject([{ name: "Push-ups", section: null, rows: null, quickReps: { repsLow: 10, repsHigh: 10 } }]);
  });
  it("set lines before any heading are notes (no title to name the exercise)", () => expect(read(["Set 1: 5 Reps", "Strength", "x."]).notes).toBe("Set 1: 5 Reps"));
});

describe("10.4 AC7 — a strength block from set lines", () => {
  it("one exercise named by the section, a row per set line, tails in the item note, the rest in the section note", () => {
    const r = read(["Strict Press", "Heavy 10", "6 Sets, 1 Set Every 2:00", "Set 1: 6 Reps @ 45–50%", "Set 2: 4 reps", "Set 3: 10 Reps @ Build If Able", "Score: Heaviest set.", "Coaching words here."]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: "Strict Press", section: 0, repsText: "6-4-10", noteLines: ["Set 1 @ 45–50%", "Set 3 @ Build If Able"], run: null });
    expect(rowsOf(r.items[0]!)).toEqual([[6, 6], [4, 4], [10, 10]]);
    expect(r.sections[0]!.notes).toBe("Heavy 10\n6 Sets, 1 Set Every 2:00\nScore: Heaviest set.\nCoaching words here.");
  });
});

describe("10.4 AC8 — scheme blocks and runs", () => {
  it("a scheme sets the reps; Directly into: and a second scheme start a second run; a colon line closes the list", () => {
    const r = read(['Workout: "S"', "For Time:", "21-15-9", "Power Clean", "Hand Release Pushups", "Directly into:", "21–15–9", "Push Press", "400 Meter Run", "LV1: 45/35, Hang Power Cleans", "Thrusters"]);
    expect(r.items.map((i) => [i.name, i.run])).toEqual([["Power Clean", 1], ["Hand Release Pushups", 1], ["Push Press", 2], ["400 Meter Run", 2]]);
    expect(rowsOf(r.items[0]!)).toEqual([[21, 21], [15, 15], [9, 9]]);
    expect(r.items[0]!.repsText).toBe("21-15-9");
    expect(r.sections[0]!.notes).toBe("For Time:\nLV1: 45/35, Hang Power Cleans\nThrusters");
  });
  it.each(["Push the sled hard and fast today now", "Rest: 2 min", "Go!", "Done.", "123", "3 Sets"])("%s is not a movement", (l) =>
    expect(read(["Engine", "21-15-9", l, "x."]).items.map((i) => i.name)).not.toContain(l));
  it("a leading rep form under a scheme moves to the item note", () =>
    expect(read(["Engine", "21-15-9", "10 Thrusters", "x."]).items[0]).toMatchObject({ name: "Thrusters", noteLines: ["10"] }));
});

describe("10.4 AC9 — lead-ins and rep forms", () => {
  it.each([["3 Sets:", 3], ["4 sets", 4], ["2 Rounds", 2], ["then, 1 Round:", 1]])("%s → %i rows", (lead, n) =>
    expect(read(["Accessory", lead as string, "- Curl", "x."]).items[0]!.rows).toHaveLength(n as number));
  it("10 / 10-15 / 10/10 / no reps", () => {
    const r = read(["Accessory", "3 Sets:", "10 Front Raise", "10-15 Reverse Fly", "10/10 DB Lateral Lunge", "Face Pull", "x."]);
    expect(r.items.map((i) => [i.name, i.rows![0], i.repsText, i.noteLines])).toEqual([
      ["Front Raise", { repsLow: 10, repsHigh: 10 }, "10", []],
      ["Reverse Fly", { repsLow: 10, repsHigh: 15 }, "10-15", []],
      ["DB Lateral Lunge", { repsLow: 20, repsHigh: 20 }, "10/10", ["10/10"]],
      ["Face Pull", { repsLow: null, repsHigh: null }, null, []],
    ]);
  });
  it.each([["150 Double Unders", "150 Double Unders"], ["15-10 Curl", "15-10 Curl"], ["60/60 Step Ups", "60/60 Step Ups"], ["0 Curl", "0 Curl"]])("%s keeps its number in the name", (l, name) => expect(read(["Accessory", "3 Sets:", l, "x."]).items[0]!.name).toBe(name));
  it("a lead-in count outside 1–99 is not a lead-in", () => expect(read(["Accessory", "1000 Sets:", "- 10 Curl", "x."]).items[0]!.rows).toBeNull());
  it("a 9-movement run keeps one run id (the plan splits it, AC17)", () => {
    const r = read(["Circuit", "2 Rounds", ...Array.from({ length: 9 }, (_, k) => `Move ${String.fromCharCode(65 + k)}x`), "x."]);
    expect(new Set(r.items.map((i) => i.run))).toEqual(new Set([1]));
  });
});

describe("10.4 AC10 — bare lists and numbered sentences", () => {
  it("a bullet with a rep form is a rowless exercise; consecutive bullets are not grouped", () => {
    const r = read(["Strength", "- 8 Goblet Squat", "• 10-12 Curl", "x."]);
    expect(r.items.map((i) => [i.name, i.rows, i.quickReps, i.run])).toEqual([
      ["Goblet Squat", null, { repsLow: 8, repsHigh: 8 }, null], ["Curl", null, { repsLow: 10, repsHigh: 12 }, null]]);
  });
  it("an un-bulleted numbered line with no lead-in is a note", () => {
    const l = "5 Minutes to build to first strict press weight (build by 3-5 reps)";
    expect(read(["Strength", l, "x."]).sections[0]!.notes).toBe(`${l}\nx.`);
  });
  it("a bullet without a rep form is a note", () => expect(read(["Strength", "- Stretch hips", "x."]).items).toEqual([]));
});

describe("10.4 AC11 — distances and times in a name", () => {
  it.each([["400 Meter Run", "400 Meter"], ["1 Mile Run", "1 Mile"], ["400m Row", "400m"], ["2 Min Plank", "2 Min"]])("%s", (l, lead) =>
    expect(read(["Engine", "3 Rounds", l, "x."]).items[0]).toMatchObject({ name: l, noteLines: [lead] }));
});

describe("10.4 AC45 — badge-tagged headers are the sections", () => {
  it("only tagged lines head sections when a paste has badges", () => {
    const r = read(["Warmup", "NO SCORE", "x", "INTENT", "Strength", "REPS", "10 Curl"]);
    expect(r.sections.map((s) => s.name)).toEqual(["Warmup", "Strength"]);
    expect(r.sections[0]!.notes).toBe("x\nINTENT");
  });
  it("a tagged Workout: \"X\" line is named X", () => expect(read(['Workout: "Engine"', "TIME", "a note."]).sections.map((s) => s.name)).toEqual(["Engine"]));
  it("with no badge, guessed headings work as before", () =>
    expect(read(["INTENT", "a note.", "Strength", "10 Curl", "x."]).sections.map((s) => s.name)).toEqual(["INTENT", "Strength"]));
});

describe("10.4 AC46 — a repeated tagged header continues its section", () => {
  it("two screenshots that both start with the header, with no overlap between them, give one section", () => {
    const r = read(["11:08", 'Workout: "Run"', "REPS", "First part.", "11:09 →", 'Workout: "Run"', "REPS", "Second part."]);
    expect(r.sections.map((s) => s.name)).toEqual(["Run"]);
    expect(r.sections[0]!.notes).toBe("First part.\nSecond part.");
    expect(r.lines.placed.filter((p) => p.as === "heading")).toHaveLength(2);
  });
  it("an untagged repeat in a badge paste is a note (Review Focus 4)", () => {
    const r = read(['Workout: "Run"', "REPS", "First part.", 'Workout: "Run"']);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.notes).toBe('First part.\nWorkout: "Run"');
  });
});

describe("10.4 AC47 — the card's repeated first line is dropped", () => {
  it("Warmup under Warmup is not added to the note, and is placed as a heading", () => {
    const r = read(["Warmup", "NO SCORE", "Warmup", "Stretch"]);
    expect(r.sections[0]!.notes).toBe("Stretch");
    expect(r.lines.placed.map((p) => p.as)).toEqual(["heading", "heading", "note"]);
  });
  it("only the first line: a later repeat stays", () => expect(read(["Warmup", "NO SCORE", "Stretch", "Warmup"]).sections[0]!.notes).toBe("Stretch\nWarmup"));
});

describe("10.4 AC52 — alternatives after a label are notes", () => {
  it.each(["Scaled Run:", "Non- Run", "Non Run", "(No Bike)", "INTENT"])("after %s, a lead-in and a movement are notes", (label) => {
    const r = read(["Strength", "REPS", label, "3 Sets:", "10 Curl", "Accessory", "NO SCORE", "3 Sets:", "10 Row"]);
    expect(r.sections[0]!.notes).toBe(`${label}\n3 Sets:\n10 Curl`);
    expect(r.items.map((i) => [i.name, i.section])).toEqual([["Row", 1]]);
  });
  it("lead-ins and separators ending in a colon are not labels", () =>
    expect(read(["Strength", "REPS", "3 Sets:", "10 Curl"]).items.map((i) => i.name)).toEqual(["Curl"]));
  it.each(["For Time:", "EMOM", "AMRAP", "STRICT PRESS BUILD TO A 10RM"])("a format line like %s is not a label (Review Focus 5)", (line) =>
    expect(read(["Strength", "REPS", line, "3 Sets:", "10 Curl"]).items.map((i) => i.name)).toEqual(["Curl"]));
  it.each(["AT HOME or ON THE ROAD", "Outdoor:", "Modified:", "Options"])("%s is a label", (label) =>
    expect(read(["Strength", "REPS", label, "3 Sets:", "10 Curl"]).items).toEqual([]));
});
