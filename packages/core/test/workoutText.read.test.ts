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
  it("an un-bulleted numbered sentence is a note (AC62 keeps AC8's limits)", () => {
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
  it("an untagged repeat of a strict header continues the section too (Review Focus 4; code review fix)", () => {
    const r = read(['Workout: "Run"', "REPS", "First part.", 'Workout: "Run"']);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.notes).toBe("First part.");
    expect(r.lines.placed.map((p) => p.as)).toEqual(["heading", "note", "heading"]);
  });
  it("an untagged generic title in a badge paste is a note", () =>
    expect(read(['Workout: "Run"', "REPS", "First part.", "Front Rack Carry", "x."]).sections[0]!.notes).toBe("First part.\nFront Rack Carry\nx."));
});

describe("10.4 AC47 — the repeated first line of a card is dropped", () => {
  it("Warmup under Warmup is not added to the note, and is placed as a heading", () => {
    const r = read(["Warmup", "NO SCORE", "Warmup", "Stretch"]);
    expect(r.sections[0]!.notes).toBe("Stretch");
    expect(r.lines.placed.map((p) => p.as)).toEqual(["heading", "heading", "note"]);
  });
  it("a later repeat of the header word continues the section (it is a header, not a note)", () =>
    expect(read(["Warmup", "NO SCORE", "Stretch", "Warmup"]).sections[0]!.notes).toBe("Stretch"));
  it("a first line that only resembles a non-strict header stays", () => {
    const r = read(["Front Rack", "WEIGHT", "Front Rack Carry", "10 Lunges"]);
    expect(r.sections[0]!.notes).toBe("Front Rack Carry");
    // AC62 (owner ruling 2026-10-26): the counted line after it is an exercise.
    expect(r.items.map((i) => i.name)).toEqual(["Lunges"]);
  });
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

const tenNull = Array.from({ length: 10 }, () => [null, null]);

describe("10.4 AC48 — N Sets, 1 Set Every M:SS sets the count", () => {
  it("opens a run of N and stays in the note", () => {
    const r = read(["Accessory", "NO SCORE", "3 Sets, 1 Set Every 4:00", "10-15 Double DB Bench Press", "15 DB or Plate Front Raises"]);
    expect(r.items.map((i) => [i.name, rowsOf(i)])).toEqual([
      ["Double DB Bench Press", [[10, 15], [10, 15], [10, 15]]],
      ["DB or Plate Front Raises", [[15, 15], [15, 15], [15, 15]]],
    ]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
    expect(r.sections[0]!.notes).toBe("3 Sets, 1 Set Every 4:00");
    expect(r.lines.placed[1]).toEqual({ text: "3 Sets, 1 Set Every 4:00", as: "note" });
  });
  it("a plain '3 Sets:' lead-in still works and is not in the note", () =>
    expect(read(["Accessory", "NO SCORE", "3 Sets:", "10 Curl"]).sections[0]!.notes).toBe(""));
});

describe("10.4 AC49 — interval lines do not end a run", () => {
  it("work/rest, comma and Rest lines go to the note and keep the run open", () => {
    const r = read(['Workout: "Go"', "REPS", "10 Sets, 1 Set Every 3:00", "90s on / 90s Rest", "In a 90s Time window,", "200 Meter Run+", "1:30 on / 1:30 REst", "10x 90s on / 90s Rest", "Rest 90s and Repeat"]);
    expect(r.items.map((i) => i.name)).toEqual(["200 Meter Run"]);
    expect(r.sections[0]!.notes.split("\n")).toEqual([
      "10 Sets, 1 Set Every 3:00", "90s on / 90s Rest", "In a 90s Time window,", "1:30 on / 1:30 REst", "10x 90s on / 90s Rest", "Rest 90s and Repeat",
    ]);
  });
});

describe("#169 — a name with no letters or digits is its own name, per written form", () => {
  it("!!! and ??? are two names; a second !!! shares the first (set lines take their section's name)", () => {
    const r = read(["!!!", "REPS", "Set 1: 5 reps", "???", "REPS", "Set 1: 5 reps", "!!!", "REPS", "Set 1: 3 reps"]);
    expect(r.names.map((n) => n.written)).toEqual(["!!!", "???"]);
    expect(new Set(r.items.map((i) => i.nameKey)).size).toBe(2);
    expect(r.names.every((n) => n.key !== "")).toBe(true);
  });
  it("a real name keeps its normalized key", () => expect(read(["Bench Press", "REPS", "Set 1: 5 reps"]).names[0]!.key).toBe("benchpress"));
});

describe("#155 — Rest-Pause, a trailing comma and complexes under an open run", () => {
  const under = (...lines: string[]) => read(["Strength", "3 Sets:", ...lines]);
  it.each(["Rest-Pause Curls", "Rest Pause Curls", "8 Rest-Pause Curls"])("%s is an exercise, not a Rest line", (line) =>
    expect(under(line).items.map((i) => i.name)).toEqual([line.replace(/^8 /, "")]));
  it.each(["Rest", "Rest:", "Rest 90s", "Rest as needed", "REST 2 min between rounds"])("%s is still a note that keeps the run open", (line) => {
    const r = under(line, "10 Squats");
    expect(r.items.map((i) => i.name)).toEqual(["Squats"]);
    expect(r.sections[0]!.notes).toContain(line);
  });
  it("a movement with a rep form and a trailing comma is an exercise, named without the comma", () =>
    expect(under("10 Push-ups,", "10 Squats").items.map((i) => i.name)).toEqual(["Push-ups", "Squats"]));
  it.each(["2 Rounds of,", "5 Rounds of,", "3 Supersets of,", "4 times through,", "8 Rest,"])("%s is structure, not an exercise (review)", (line) =>
    expect(under(line, "10 Squats").items.map((i) => i.name)).toEqual(["Squats"]));
  it.each(["Rest-Pause between sets", "Rest pause as needed", "Rest pause 30s"])("%s is still a Rest note (review)", (line) =>
    expect(under(line, "10 Squats").items.map((i) => i.name)).toEqual(["Squats"]));
  it("an en dash reads like a hyphen: Rest–Pause Curls is an exercise (review)", () =>
    expect(under("Rest–Pause Curls").items.map((i) => i.name)).toEqual(["Rest–Pause Curls"]));
  it("a bulleted rowless line outside a run drops its trailing comma too (review)", () =>
    expect(read(["Strength", "- 10 Push-ups,"]).items.map((i) => i.name)).toEqual(["Push-ups"]));
  it("a cue with a trailing comma and no rep form is still a note", () =>
    expect(under("Keep the pace steady,", "10 Squats").items.map((i) => i.name)).toEqual(["Squats"]));
  it("a barbell complex splits into a superset, like any A + B (owner ruling 2026-10-25)", () => {
    const r = under("2 Power Clean + 1 Push Jerk");
    expect(r.items.map((i) => i.name)).toEqual(["Power Clean", "Push Jerk"]);
    expect(r.items[0]!.run).not.toBeNull();
    expect(r.items.map((i) => i.run)).toEqual([r.items[0]!.run, r.items[0]!.run]);
  });
});

describe("10.4 AC50 — interval movements", () => {
  const run = (line: string) => read(['Workout: "Go"', "REPS", "10 Sets, 1 Set Every 3:00", line]).items[0];
  it("a leading distance keeps the name as written (AC11), minus a trailing +", () =>
    expect(run("200 Meter Run+")).toMatchObject({ name: "200 Meter Run", noteLines: ["200 Meter"] }));
  it("a Max line names the movement and keeps Max Cal and the time limit in the note", () => {
    const item = run("Max Cal Echo Bike with remaining time")!;
    expect(item).toMatchObject({ name: "Echo Bike", noteLines: ["Max Cal, with remaining time"] });
    expect(rowsOf(item)).toEqual(tenNull);
  });
});

describe("10.4 AC51 — A + B is two exercises", () => {
  it("each part with a rep form becomes its own exercise in the same run", () => {
    const r = read(["Accessory", "NO SCORE", "3 Sets, 1 Set Every 4:00", "10 Tuckups + 15 Hollow Rocks"]);
    expect(r.items.map((i) => [i.name, rowsOf(i)])).toEqual([
      ["Tuckups", [[10, 10], [10, 10], [10, 10]]],
      ["Hollow Rocks", [[15, 15], [15, 15], [15, 15]]],
    ]);
    expect(r.items[0]!.run).toBe(r.items[1]!.run);
    expect(r.lines.placed.filter((p) => p.as === "movement")).toHaveLength(1);
  });
  it("'200 Meter Run+' is never split", () =>
    expect(read(['Workout: "Go"', "REPS", "3 Sets:", "200 Meter Run+"]).items.map((i) => i.name)).toEqual(["200 Meter Run"]));
  it("a part without reps keeps the line whole", () =>
    expect(read(["Accessory", "NO SCORE", "3 Sets:", "10 Tuckups + Hollow Rocks"]).items.map((i) => i.name)).toEqual(["Tuckups + Hollow Rocks"]));
});

describe("10.4 AC45 — a header at a screenshot edge keeps its section (final review)", () => {
  it("a badge that opens the next screenshot tags the header at the end of the one before", () => {
    const r = read(["11:00", 'Workout: "X"', "REPS", "3 Sets:", "10 Push-ups", "10 Sit-ups", "Accessory", "11:01", "NO SCORE", "3 Sets:", "10 Front Raise", "10 Reverse Fly"]);
    expect(r.sections.map((s) => s.name)).toEqual(["X", "Accessory"]);
    expect(r.items.map((i) => [i.name, i.section])).toEqual([["Push-ups", 0], ["Sit-ups", 0], ["Front Raise", 1], ["Reverse Fly", 1]]);
  });
  it("a strict header cut off at the bottom edge, with no repeat in the next screenshot, is still a section", () => {
    const r = read(["11:00", 'Workout: "X"', "REPS", "3 Sets:", "10 Push-ups", "Accessory", "11:01", "3 Sets:", "10 Front Raise"]);
    expect(r.sections.map((s) => s.name)).toEqual(["X", "Accessory"]);
    expect(r.items.map((i) => [i.name, i.section])).toEqual([["Push-ups", 0], ["Front Raise", 1]]);
  });
  it("a generic title at a screenshot's end is not promoted", () =>
    expect(read(["11:00", 'Workout: "X"', "REPS", "a note.", "Front Rack Carry", "11:01", "more."]).sections.map((s) => s.name)).toEqual(["X"]));
});

describe("10.4 AC45 / AC52 / AC48 — code review fixes", () => {
  it("a stray badge word in a non-gym paste keeps the strict headings (AC45)", () =>
    expect(read(["Warmup", "Easy row.", "Strength", "Back Squat", "Weight", "5 Sets:", "5 Back Squat", "Conditioning", "21-15-9", "Thrusters", "x."]).sections.map((s) => s.name))
      .toEqual(["Warmup", "Strength", "Back Squat", "Conditioning"]));
  it("a parenthesized cue keeps the run open; later movements are exercises (AC52)", () => {
    const r = read(["Strength", "REPS", "3 Rounds:", "10 Lunges", "(each leg)", "15 Pushups", "20 Situps"]);
    expect(r.items.map((i) => i.name)).toEqual(["Lunges", "Pushups", "Situps"]);
    expect(r.sections[0]!.notes).toBe("(each leg)");
  });
  it.each(["Advanced Plank", "Home stretch", "Options for the rower"])("%s is not a label (AC52)", (line) =>
    expect(read(["Strength", "REPS", "3 Rounds:", "10 Lunges", line, "15 Pushups"]).items.map((i) => i.name)).toContain("Pushups"));
  it.each(["Scaled:", "Options", "(No Bike)", "(Without a rower)"])("%s is still a label (AC52)", (label) =>
    expect(read(["Strength", "REPS", label, "3 Sets:", "10 Curl"]).items).toEqual([]));
  it("after 'N Sets, 1 Set Every', coaching lines are notes and only real movements are exercises (AC48)", () => {
    const r = read(["Strength", "WEIGHT", "5 Sets, 1 Set Every 2:00", "Build to a heavy 5", "Tempo 3-1-1", "5 Back Squat"]);
    expect(r.items.map((i) => i.name)).toEqual(["Back Squat"]);
    expect(r.sections[0]!.notes.split("\n")).toEqual(["5 Sets, 1 Set Every 2:00", "Build to a heavy 5", "Tempo 3-1-1"]);
  });
  it("a *** separator still ends the run", () =>
    // AC62 (owner ruling 2026-10-26): "400m Run" after it is its own rowless exercise, outside the 3-round run.
    expect(read(["Strength", "REPS", "3 Rounds:", "10 Pushups", "***", "400m Run"]).items.map((i) => [i.name, i.run, i.rows?.length ?? null])).toEqual([
      ["Pushups", 1, 3], ["400m Run", 2, null]]));
});

describe("10.4 AC49 / AC50 / AC51 / AC52 — deferred minors 69, 70, 74 and the owner's Max ruling", () => {
  const run = (line: string) => read(['Workout: "Go"', "REPS", "10 Sets, 1 Set Every 3:00", line]).items[0];
  it.each(["Rx:", "Rx", "RX: 95/65 lb", "(Rx)", "Rx (95/65 lb)", "Rx Weights: 95/65", "Rx'd: 95/65"])("%s is a note that keeps the run open; the movements after it are exercises (item 69)", (label) => {
    const r = read(["Strength", "REPS", "3 Rounds:", label, "10 Thrusters", "10 Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(r.sections[0]!.notes).toBe(label);
  });
  it("Rx with no run open is a note, not a label: a later lead-in still reads (item 69)", () => {
    const r = read(["Strength", "REPS", "Rx:", "3 Sets:", "10 Curl"]);
    expect(r.items.map((i) => i.name)).toEqual(["Curl"]);
    expect(r.sections[0]!.notes).toBe("Rx:");
  });
  it("a bulleted line with no run drops its trailing + too (item 74, code review)", () =>
    expect(read(["Strength", "REPS", "- 10 Push-ups +"]).items.map((i) => i.name)).toEqual(["Push-ups"]));
  it("Rx Bar Hang is a movement, not an Rx line (item 69)", () =>
    expect(read(["Strength", "REPS", "3 Sets:", "Rx Bar Hang"]).items.map((i) => i.name)).toEqual(["Rx Bar Hang"]));
  it.each([["Max Hang", "Hang"], ["Max Effort Sprint", "Effort Sprint"], ["Max Burpees", "Burpees"], ["MAX Wall Balls", "Wall Balls"]])("%s: Max is a rep count, so it always leaves the name (owner, 2026-10-24)", (line, name) =>
    expect(read(["Strength", "REPS", "3 Sets:", line]).items[0]).toMatchObject({ name, noteLines: ["MAX Wall Balls" === line ? "MAX" : "Max"] }));
  it.each([
    ["Max Burpees with remaining time", "Burpees", "Max, with remaining time"],
    ["Max Cal Row", "Row", "Max Cal"],
    ["Max Calories Ski", "Ski", "Max Calories"],
    ["Max Reps Pull-ups", "Pull-ups", "Max Reps"],
  ])("%s strips the Max form into the note", (line, name, note) => expect(run(line)).toMatchObject({ name, noteLines: [note] }));
  it("a bulleted Max line with no run is a rowless exercise (owner, 2026-10-24)", () =>
    expect(read(["Strength", "REPS", "- Max Burpees"]).items).toMatchObject([{ name: "Burpees", rows: null, noteLines: ["Max"] }]));
  it.each([
    ["Max Cal Echo Bike +", ["Echo Bike"]],
    ["10 Tuckups + 15 Hollow Rocks +", ["Tuckups", "Hollow Rocks"]],
  ])("a trailing + is dropped before every branch: %s (item 74)", (line, names) =>
    expect(read(["Accessory", "NO SCORE", "3 Sets:", line]).items.map((i) => i.name)).toEqual(names));
});

describe("10.4 AC60 — a load after @ is the exercise's note", () => {
  it("under a set run", () => {
    const r = read(["Back Squat", "4 Sets, 1 Set Every 4:00", "5 Back Squats @ 60-65% of IRM", "x."]);
    expect(r.items.map((i) => [i.name, rowsOf(i), i.noteLines])).toEqual([["Back Squats", [[5, 5], [5, 5], [5, 5], [5, 5]], ["@ 60-65% of IRM"]]]);
  });
  it("under a scheme", () => expect(read(["Engine", "21-15-9", "Thrusters @ 95/65", "x."]).items[0]).toMatchObject({ name: "Thrusters", noteLines: ["@ 95/65"] }));
  it("on a bullet", () => expect(read(["Strength", "- 8 Goblet Squat @ 24 kg", "x."]).items[0]).toMatchObject({ name: "Goblet Squat", noteLines: ["@ 24 kg"] }));
  it("a load summary with no name stays a note", () => expect(read(["Strength", "4x5 @ 60%", "x."]).items).toEqual([]));
});

describe("10.4 AC61 — a set-count range opens a run", () => {
  it.each([["3-4 Sets", 3], ["3–4 Rounds:", 3], ["2-3 sets", 2]] as const)("%s opens a run of the low end and stays in the note", (l, n) => {
    const r = read(["Accessory", l, "12 Cossack Squats", "5/5 KB Windmill"]);
    expect(r.items.map((i) => [i.name, rowsOf(i)?.length, i.run])).toEqual([["Cossack Squats", n, 1], ["KB Windmill", n, 1]]);
    expect(r.sections[0]!.notes).toBe(l);
  });
  it.each(["4-3 Sets", "0-2 Sets", "3-100 Sets"])("%s does not", (l) => expect(read(["Accessory", l, "x."]).items).toEqual([]));
});

describe("10.4 AC62 — a counted line is an exercise without a lead-in (owner ruling 2026-10-26)", () => {
  it("an AMRAP list is rowless and one run; AMRAP stays in the note", () => {
    const r = read(['Workout: "MORRO BAY"', "AMRAP 15", "250/200m Row", "18 Alternating Double DB Reverse Lunges", "200 Meter Run", "18 Double DB Alternating Strict Press", "Score: Total rounds + reps."]);
    expect(r.items.map((i) => [i.name, i.rows, i.quickReps, i.noteLines, i.run])).toEqual([
      ["250/200m Row", null, null, ["250/200m"], 1],
      ["Alternating Double DB Reverse Lunges", null, { repsLow: 18, repsHigh: 18 }, [], 1],
      ["200 Meter Run", null, null, ["200 Meter"], 1],
      ["Double DB Alternating Strict Press", null, { repsLow: 18, repsHigh: 18 }, [], 1],
    ]);
    expect(r.sections[0]!.notes).toBe("AMRAP 15\nScore: Total rounds + reps.");
  });
  it("a calorie line and a/b reps", () =>
    expect(read(["Engine", "20 Cal Row", "5/5 KB Windmill", "x."]).items.map((i) => [i.name, i.noteLines, i.calories])).toEqual([["Row", ["20 Cal"], true], ["KB Windmill", ["5/5"], false]]));
  it.each(["20 Minute Cap", "10 minutes rest", "2 min break", "2 Rounds for time", "3 times through", "8 Rest", "10 Reps of", "5 Minutes to build to first strict press weight (build by 3-5 reps)", "18 reps are intentional, representing a date.", "(10 each side)"])(
    "%s stays a note (Review Focus 3)", (l) => expect(read(["Engine", l, "x."]).items).toEqual([]));
  it("Warmup, the preamble and lines after a variant label get no list", () => {
    expect(read(["Warmup", "10 Air Squats", "x."]).items).toEqual([]);
    expect(read(["10 Air Squats", "Strength", "x."]).items).toEqual([]);
    expect(read(["Engine", "Scaled:", "10 Air Squats"]).items).toEqual([]);
  });
  it("any other line closes the list; the next list is a new run (Review Focus 4)", () => {
    const r = read(["Engine", "10 Air Squats", "10 Push-ups", "Rest as needed.", "10 Lunges", "3 Sets:", "10 Curl"]);
    expect(r.items.map((i) => [i.name, i.run, i.rows?.length ?? null])).toEqual([["Air Squats", 1, null], ["Push-ups", 1, null], ["Lunges", 2, null], ["Curl", 3, 3]]);
  });
  it("a bullet closes the list and stays ungrouped (AC10)", () =>
    expect(read(["Engine", "10 Air Squats", "- 8 Goblet Squat", "10 Lunges"]).items.map((i) => [i.name, i.run])).toEqual([["Air Squats", 1], ["Goblet Squat", null], ["Lunges", 2]]));
  it("a heading closes the list", () =>
    expect(read(["Engine", "10 Air Squats", "Accessory", "10 Lunges"]).items.map((i) => [i.name, i.section, i.run])).toEqual([["Air Squats", 0, 1], ["Lunges", 1, 2]]));
});

describe("10.4 AC62 — final review fixes", () => {
  it("an open list does not stop a generic title from heading a section (non-badge paste)", () => {
    const r = read(["Strength", "10 Push Ups", "12 Air Squats", "Core Work", "20 Sit Ups"]);
    expect(r.sections.map((s) => s.name)).toEqual(["Strength", "Core Work"]);
    expect(r.items.map((i) => [i.name, i.section])).toEqual([["Push Ups", 0], ["Air Squats", 0], ["Sit Ups", 1]]);
  });
  it.each(["1 More Round", "5 Each Side", "12 Total", "3 Attempts", "100 Meters Easy", "400m Then Rest", "10 per side"])(
    "%s is a qualifier, not an exercise", (l) => expect(read(["Engine", l, "x."]).items).toEqual([]));
});

describe("10.4 AC60 / AC62 — /code-review fixes", () => {
  it("A + B with no lead-in is two exercises in the list", () =>
    expect(read(["Metcon", "NO SCORE", "10 Burpees + 10 Air Squats", "12 Pull-ups"]).items.map((i) => [i.name, i.run])).toEqual([
      ["Burpees", 1], ["Air Squats", 1], ["Pull-ups", 1]]));
  it("a trailing comma does not end the list (#155)", () =>
    expect(read(["Metcon", "NO SCORE", "10 Burpees", "10 Push-ups,", "12 Pull-ups"]).items.map((i) => [i.name, i.run])).toEqual([
      ["Burpees", 1], ["Push-ups", 1], ["Pull-ups", 1]]));
  it.each([["3 Rounds", "5 Back Squats @ 62.5 kg,"], ["3 Rounds", "10 Front Squats @ 60-65% of your 1RM,"]])(
    "a comma after the load is not part of the load: %s / %s", (lead, l) => {
      const r = read(["Strength", lead, l, "x."]);
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.noteLines.at(-1)).not.toMatch(/,$/);
    });
});

describe("10.4 AC63 — notes don't end a N Sets, 1 Set Every run", () => {
  it("movements after 'Accessory Between Sets:' join the lift's run", () => {
    const r = read(["Back Squat", "WEIGHT", "4 Sets, 1 Set Every 4:00", "5 Back Squats @ 60-65% of IRM", "*All sets, same weight across*", "Accessory Between Sets:", "10 TOES elevated DB Romanian deadlifts", "16 Landmine twists", "Score: weight lifted for 4 sets."]);
    expect(r.items.map((i) => [i.name, rowsOf(i)?.length, i.run])).toEqual([["Back Squats", 4, 1], ["TOES elevated DB Romanian deadlifts", 4, 1], ["Landmine twists", 4, 1]]);
  });
});

/** Minor 110's pin: each line as a bare bullet (step 8) and as an AC62 counted line, read before the shared reader. */
describe("Minor 110 — the bullet and counted-line rowless readers read as before", () => {
  type View = [string, string[], [number | null, number | null] | null, string | null, boolean];
  const view = (i: ReadItem): View => [i.name, [...i.noteLines], i.quickReps === null ? null : [i.quickReps.repsLow, i.quickReps.repsHigh], i.repsText, i.calories];
  it.each<[string, View[], View[]]>([
    ["10 Push-ups", [["Push-ups", [], [10, 10], "10", false]], [["Push-ups", [], [10, 10], "10", false]]],
    ["8-12 Curls", [["Curls", [], [8, 12], "8-12", false]], [["Curls", [], [8, 12], "8-12", false]]],
    ["5/5 KB Windmill", [["KB Windmill", ["5/5"], [10, 10], "5/5", false]], [["KB Windmill", ["5/5"], [10, 10], "5/5", false]]],
    ["20 Cal Row", [["Row", ["20 Cal"], null, null, true]], [["Row", ["20 Cal"], null, null, true]]],
    ["20/15 Cal Row", [["Row", ["20/15 Cal"], null, null, true]], [["Row", ["20/15 Cal"], null, null, true]]],
    ["Max Cal Bike", [["Bike", ["Max Cal"], null, null, true]], [["Bike", ["Max Cal"], null, null, true]]],
    ["Max Reps Pull-ups", [["Pull-ups", ["Max Reps"], null, null, false]], []],
    ["200 Meter Run", [], [["200 Meter Run", ["200 Meter"], null, null, false]]],
    ["250/200m Row", [], [["250/200m Row", ["250/200m"], null, null, false]]],
    ["10 Back Squats @ 60%", [["Back Squats", ["@ 60%"], [10, 10], "10", false]], [["Back Squats", ["@ 60%"], [10, 10], "10", false]]],
  ])("%s", (line, asBullet, asCounted) => {
    expect(read([`- ${line}`]).items.map(view)).toEqual(asBullet);
    expect(read(["Engine", line]).items.map(view)).toEqual(asCounted);
  });
});

describe("Minor 108 — a trailing for time goes to the note", () => {
  it.each([
    ["1 Mile Run for time", "1 Mile Run", ["1 Mile", "for time"]],
    ["1 Mile Run For Time", "1 Mile Run", ["1 Mile", "For Time"]],
    ["21 Thrusters for time", "Thrusters", ["for time"]],
  ])("%s → %s", (line, name, noteLines) => {
    const r = read(["Engine", line]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([[name, noteLines]]);
  });
  it("a standalone Max Cal line with for time names the movement alone (final review)", () => {
    const r = read(["Engine", "Max Cal Row for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines, i.calories])).toEqual([["Row", ["Max Cal", "for time"], true]]);
  });
  it("a structure line stays a note", () => {
    const r = read(["Engine", "5 Rounds for time"]);
    expect(r.items).toEqual([]);
    expect(r.sections[0]!.notes).toBe("5 Rounds for time");
  });
});

describe("Minor 215 — structure lines with for time", () => {
  it("2 Rounds for time is no exercise (minor 283: it opens a run of 2)", () => {
    const r = read(["Metcon", "2 Rounds for time", "10 Squats"]);
    expect(r.items.map((i) => [i.name, i.rows?.length ?? null, i.section, i.run])).toEqual([["Squats", 2, 0, 1]]);
  });
  it("For Time: is a note before the exercises, as before", () => {
    const r = read(['Workout: "S"', "For Time:", "21-15-9", "Power Clean"]);
    expect(r.items.map((i) => [i.name, i.noteLines, i.section, i.run])).toEqual([["Power Clean", [], 0, 1]]);
  });
  it("minor 283 — 21-15-9 for time under a run opens its own scheme run and stays in the note", () => {
    const r = read(["Metcon", "3 Rounds", "21-15-9 for time", "10 Squats"]);
    expect(r.items.map((i) => [i.name, i.rows?.map((row) => row.repsLow) ?? null, i.run])).toEqual([["Squats", [21, 15, 9], 2]]);
    expect(r.sections[0]!.notes).toContain("21-15-9 for time");
  });
  it("final review — Rounds for time under a run is a note, not an exercise named Rounds", () => {
    const r = read(["Metcon", "3 Rounds", "10 Squats", "Rounds for time", "10 Burpees"]);
    expect(r.items.map((i) => [i.name, i.rows?.length ?? null])).toEqual([
      ["Squats", 3],
      ["Burpees", 3],
    ]);
  });
});

describe("Minor 215 code review — for time does not turn a sentence or a structure bullet into an exercise", () => {
  it("a long cue sentence ending in for time stays a note, as on main", () => {
    const r = read(["Metcon", "5 Rounds", "10 Pull-ups", "Finish with a 1 mile run for time"]);
    expect(r.items.map((i) => i.name)).toEqual(["Pull-ups"]);
    expect(r.sections[0]!.notes).toContain("Finish with a 1 mile run for time");
  });
  it("Then complete the following circuit for time is no exercise", () => {
    const r = read(["Metcon", "5 Rounds", "10 Pull-ups", "Then complete the following circuit for time", "Row 500m"]);
    expect(r.items.map((i) => i.name)).not.toContain("Then complete the following circuit");
  });
  it("a bulleted 3 Rounds for time is no exercise named Rounds", () => {
    expect(read(["Metcon", "- 3 Rounds for time"]).items).toEqual([]);
  });
});

describe("Minor 215 final review — a comma before for time, and for time on a single part", () => {
  it("10 Push-ups, for time under a run is the exercise, with for time as its note", () => {
    const r = read(["Metcon", "3 Rounds", "10 Push-ups, for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([["Push-ups", ["for time"]]]);
  });
  it("a counted A + B line with for time on its first part puts it on that part only", () => {
    const r = read(["Metcon", "10 Squats for time + 10 Burpees"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([
      ["Squats", ["for time"]],
      ["Burpees", []],
    ]);
  });
  it("the same under a run", () => {
    const r = read(["Metcon", "3 Rounds", "10 Squats for time + 10 Burpees"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([
      ["Squats", ["for time"]],
      ["Burpees", []],
    ]);
  });
});

describe("Minor 215 — a trailing for time goes to the note on every movement line", () => {
  it("under a run", () => {
    const r = read(["Metcon", "3 Rounds", "400 m Run for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([["400 m Run", ["400 m", "for time"]]]);
  });
  it("on a bullet", () => {
    const r = read(["Metcon", "- 21 Thrusters for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([["Thrusters", ["for time"]]]);
  });
  it("before a load, which stays last", () => {
    const r = read(["Metcon", "3 Rounds", "10 Thrusters for time @ 95 lb"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([["Thrusters", ["for time", "@ 95 lb"]]]);
  });
});

describe("Minor 216 — on an A + B line, for time goes to every part", () => {
  it("a counted line", () => {
    const r = read(["Metcon", "400 m Run + 50 Burpees for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([
      ["400 m Run", ["400 m", "for time"]],
      ["Burpees", ["for time"]],
    ]);
  });
  it("under a run", () => {
    const r = read(["Metcon", "3 Rounds", "10 Squats + 10 Burpees for time"]);
    expect(r.items.map((i) => [i.name, i.noteLines])).toEqual([
      ["Squats", ["for time"]],
      ["Burpees", ["for time"]],
    ]);
  });
});

describe("10.4 AC8 / minor 283 — a scheme or lead-in ending in for time opens its run (owner ruling 2026-10-31)", () => {
  const view = (r: ReturnType<typeof read>) => r.items.map((i) => [i.name, i.rows?.map((row) => row.repsLow) ?? null, i.run]);
  it("Fran: 21-15-9 for time then the movements", () => {
    const r = read(["Fran", "21-15-9 for time", "Thrusters", "Pull-ups"]);
    expect(view(r)).toEqual([
      ["Thrusters", [21, 15, 9], 1],
      ["Pull-ups", [21, 15, 9], 1],
    ]);
    expect(r.sections.map((sec) => sec.name)).toEqual(["Fran"]);
    expect(r.sections[0]!.notes).toContain("21-15-9 for time");
  });
  it("3 Rounds for time opens a run of 3", () => {
    const r = read(["Metcon", "3 Rounds for time", "10 Squats", "10 Burpees"]);
    expect(view(r)).toEqual([
      ["Squats", [10, 10, 10], 1],
      ["Burpees", [10, 10, 10], 1],
    ]);
    expect(r.sections[0]!.notes).toContain("3 Rounds for time");
  });
  it("a mid-workout 3 Rounds for time starts a new run, so the movements after it take 3 sets", () => {
    const r = read(["Metcon", "5 Rounds", "10 Pull-ups", "3 Rounds for time", "10 Squats"]);
    expect(view(r)).toEqual([
      ["Pull-ups", [10, 10, 10, 10, 10], 1],
      ["Squats", [10, 10, 10], 2],
    ]);
  });
  it("a comma before for time is the same", () => {
    const r = read(["Metcon", "3 Rounds, for time", "10 Squats"]);
    expect(view(r)).toEqual([["Squats", [10, 10, 10], 1]]);
  });
});

describe("10.4 AC67 / minor 280 — a line that is only for time is the run's note", () => {
  const names = (r: ReturnType<typeof read>) => r.items.map((i) => i.name);
  it("3 Rounds / for time / 10 Squats: one exercise of 3 sets, for time in the section note", () => {
    const r = read(["Metcon", "3 Rounds", "for time", "10 Squats"]);
    expect(r.items.map((i) => [i.name, i.rows?.length])).toEqual([["Squats", 3]]);
    expect(r.sections[0]!.notes).toBe("for time");
  });
  it.each(["For Time", "for time:", "FOR TIME:", "- for time", "• For time"])("%s is the same", (line) =>
    expect(read(["Metcon", "3 Rounds", line, "10 Squats"]).items.map((i) => [i.name, i.rows?.length])).toEqual([["Squats", 3]]));
  it("final review: For Time: after the run's movements heads a new block and closes the run, as before", () => {
    const r = read(["Metcon", "5 Rounds", "10 Squats", "10 Push-ups", "For Time:", "1 Mile Run"]);
    expect(r.items.map((i) => [i.name, i.rows?.length ?? null])).toEqual([
      ["Squats", 5],
      ["Push-ups", 5],
      ["1 Mile Run", null],
    ]);
  });
  it("a bare for time after the run's movements is still the run's note, never an exercise", () => {
    const r = read(["Metcon", "5 Rounds", "10 Squats", "for time", "10 Push-ups"]);
    expect(r.items.map((i) => [i.name, i.rows?.length])).toEqual([
      ["Squats", 5],
      ["Push-ups", 5],
    ]);
  });
  it("with no open run it stays a note, as before", () => {
    const r = read(["Metcon", "for time", "Back Squat"]);
    expect([names(r), r.sections[0]!.notes]).toEqual([[], "for time\nBack Squat"]);
  });
});

describe("10.4 AC8 / minor 283 code review — the usual spellings, and AC48 kept", () => {
  const view = (r: ReturnType<typeof read>) => r.items.map((i) => [i.name, i.rows?.map((row) => row.repsLow) ?? null]);
  it("Fran with a colon: 21-15-9 For Time:", () => {
    const r = read(["Fran", "21-15-9 For Time:", "Thrusters", "Pull-ups"]);
    expect(view(r)).toEqual([
      ["Thrusters", [21, 15, 9]],
      ["Pull-ups", [21, 15, 9]],
    ]);
    expect(r.sections[0]!.notes).toContain("21-15-9 For Time:");
  });
  it("3 Rounds For Time: opens a run of 3", () => {
    expect(view(read(["Metcon", "3 Rounds For Time:", "10 Squats"]))).toEqual([["Squats", [10, 10, 10]]]);
  });
  it("no space after the comma: 21-15-9,for time", () => {
    expect(view(read(["Metcon", "21-15-9,for time", "Thrusters"]))).toEqual([["Thrusters", [21, 15, 9]]]);
  });
  it("AC48 — 3 Sets, for time still keeps a coaching line out of the exercises", () => {
    const r = read(["Metcon", "3 Sets, for time", "Build to a heavy 5", "10 Squats"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats"]);
  });
});
