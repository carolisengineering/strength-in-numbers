import { describe, expect, it } from "vitest";
import { SectionTimerSchema, type SectionTimer } from "../src/dto/section-timer.js";
import { cleanWorkoutText, readWorkoutText, scoreKindOf, sectionTimerOf, type ScoreKind } from "../src/workoutText.js";
import { prng } from "./helpers/history-generator.js";

const setTimer = (rounds: number, roundSeconds: number): SectionTimer => ({ format: "set_timer", rounds, roundSeconds });
const timeCap = (capSeconds: number | null): SectionTimer => ({ format: "time_cap", capSeconds });
const amrap = (capSeconds: number): SectionTimer => ({ format: "amrap", capSeconds });

describe("10.7 AC45 — scoreKindOf", () => {
  it.each<[string | null, string[], ScoreKind | null]>([
    ["TIME", [], "time"],
    ["ROUNDS", [], "rounds-reps"],
    ["ROUNDS/REPS", [], "rounds-reps"],
    ["TIME/REPS", [], "time"],
    ["TIME/ROUNDS", [], null],
    ["NO SCORE", [], "other"],
    ["WEIGHT", [], "other"],
    ["REPS", [], "other"],
    ["DISTANCE", [], "other"],
    ["CALORIES", [], "other"],
    ["LOAD", [], "other"],
    ["WEIGHT", ["Score: Time to complete."], "other"],
    [null, ["Score: Time to complete."], "time"],
    [null, ["Score: Total rounds + reps."], "rounds-reps"],
    [null, ["Score: rounds completed in time"], "rounds-reps"],
    [null, ["Score: Heaviest successful set of 10 reps."], "other"],
    [null, ["Score: weight lifted for 4 sets."], "other"],
    [null, ["20 Minute Cap"], null],
    [null, [], null],
    [null, ["Heavy 10", "Score: Time to complete.", "Score: Total rounds"], "time"],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(scoreKindOf(badge, notes)).toBe(expected);
  });
});

describe("10.7 AC46, AC47, AC48 — timer lines", () => {
  it.each<[string | null, string[], SectionTimer | null]>([
    // Set Timer (time score)
    ["TIME", ["3 Sets, 1 Set Every 4:00"], setTimer(3, 240)],
    ["TIME", ["100 Sets, 1 Set Every 60:00"], setTimer(100, 3600)],
    ["TIME", ["1 Set, 1 Set Every 0:01"], setTimer(1, 1)],
    // Time Cap (time score)
    ["TIME", ["Time cap: 15:00"], timeCap(900)],
    ["TIME", ["Time cap 15"], timeCap(900)],
    ["TIME", ["Time cap 15 min"], timeCap(900)],
    ["TIME", ["Time cap 15 minutes"], timeCap(900)],
    ["TIME", ["15 Minute Cap"], timeCap(900)],
    ["TIME", ["15 Min Cap"], timeCap(900)],
    ["TIME", ["15 Minute Time Cap"], timeCap(900)],
    ["TIME", ["Time cap: 180:00"], timeCap(10800)],
    // For Time (time score)
    ["TIME", ["For Time"], timeCap(null)],
    ["TIME", ["For Time:"], timeCap(null)],
    ["TIME", ["For Time."], timeCap(null)],
    ["TIME", ["For time!"], timeCap(null)],
    // AMRAP (rounds-reps score)
    ["ROUNDS/REPS", ["AMRAP 15"], amrap(900)],
    ["ROUNDS/REPS", ["AMRAP 12:00"], amrap(720)],
    ["ROUNDS/REPS", ["12 Min AMRAP"], amrap(720)],
    ["ROUNDS/REPS", ["12 Minute AMRAP"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12 Min"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12 Minutes"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 180"], amrap(10800)],
    // Only under the matching score kind
    ["WEIGHT", ["6 Sets, 1 Set Every 2:00"], null],
    ["NO SCORE", ["3 Sets, 1 Set Every 4:00"], null],
    ["REPS", ["10 Sets, 1 Set Every 3:00"], null],
    [null, ["3 Sets, 1 Set Every 4:00"], null],
    ["TIME", ["AMRAP 15"], null],
    ["ROUNDS/REPS", ["20 Minute Cap"], null],
    ["ROUNDS/REPS", ["For Time:"], null],
    // Merely ending in "for time" doesn't count
    ["TIME", ["21-15-9 For Time"], null],
    ["TIME", ["3 Rounds for time"], null],
    // Whole lines only (AC52)
    ["ROUNDS/REPS", ["Today is an AMRAP 15 so pace yourself."], null],
    ["TIME", ["Finish under the 20 Minute Cap please"], null],
    // A time score with no timing line (D12)
    ["TIME", ["Push the pace."], null],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(sectionTimerOf(badge, notes)).toEqual(expected);
  });
});

describe("10.7 AC52 — precedence", () => {
  it("a capped Time Cap beats For Time even when it comes later", () => {
    expect(sectionTimerOf("TIME", ["For Time:", "20 Minute Cap"])).toEqual(timeCap(1200));
  });
  it("Set Timer comes first in the rule order", () => {
    expect(sectionTimerOf("TIME", ["20 Minute Cap", "3 Sets, 1 Set Every 4:00"])).toEqual(setTimer(3, 240));
  });
  it("the first matching line wins within a rule", () => {
    expect(sectionTimerOf("TIME", ["15 Minute Cap", "20 Minute Cap"])).toEqual(timeCap(900));
  });
  it("an out-of-range line isn't a match, so the next line is tried", () => {
    expect(sectionTimerOf("ROUNDS/REPS", ["AMRAP 200", "AMRAP 15"])).toEqual(amrap(900));
  });
});

describe("10.7 AC51 — ranges", () => {
  it.each<[string, string[]]>([
    ["ROUNDS/REPS", ["AMRAP 200"]],
    ["TIME", ["1 Set, 1 Set Every 90:00"]],
    ["TIME", ["0 Sets, 1 Set Every 4:00"]],
    ["TIME", ["101 Sets, 1 Set Every 1:00"]],
    ["TIME", ["Time cap: 0:00"]],
    ["TIME", ["Time cap: 180:01"]],
    ["TIME", ["3 Sets, 1 Set Every 4:60"]],
    ["ROUNDS/REPS", ["AMRAP 0"]],
  ])("%j %j → no timer", (badge, notes) => {
    expect(sectionTimerOf(badge, notes)).toBeNull();
  });

  it("every timer the rules emit passes SectionTimerSchema", () => {
    const rnd = prng(51);
    const int = (max: number) => Math.floor(rnd() * (max + 1));
    const clock = () => `${int(250)}:${String(int(99)).padStart(2, "0")}`;
    const templates: (() => string)[] = [
      () => `${int(250)} Sets, 1 Set Every ${clock()}`,
      () => `Time cap: ${clock()}`,
      () => `Time cap ${int(250)}`,
      () => `Time cap ${int(250)} min`,
      () => `Time cap ${int(250)} minutes`,
      () => `${int(250)} Minute Cap`,
      () => `${int(250)} Min Cap`,
      () => `${int(250)} Minute Time Cap`,
      () => "For Time:",
      () => `AMRAP ${int(250)}`,
      () => `AMRAP ${clock()}`,
      () => `${int(250)} Min AMRAP`,
      () => `${int(250)} Minute AMRAP`,
      () => `AMRAP ${int(250)} Min`,
      () => `AMRAP ${int(250)} Minutes`,
    ];
    const badges = ["TIME", "ROUNDS/REPS", "WEIGHT", null];
    let emitted = 0;
    for (let n = 0; n < 2000; n++) {
      const badge = badges[Math.floor(rnd() * badges.length)]!;
      const line = templates[Math.floor(rnd() * templates.length)]!();
      const timer = sectionTimerOf(badge, [line]);
      if (timer === null) continue;
      emitted++;
      expect(SectionTimerSchema.safeParse(timer).success, `${badge} ${line}`).toBe(true);
    }
    expect(emitted).toBeGreaterThan(0);
  });
});

describe("Review Focus 1 — OCR spacing and case", () => {
  it.each<[string, string[], SectionTimer]>([
    ["ROUNDS/REPS", ["amrap 15"], amrap(900)],
    ["ROUNDS/REPS", ["AMRAP15"], amrap(900)],
    ["ROUNDS/REPS", ["AMRAP 15."], amrap(900)],
    ["TIME", ["Time Cap:15:00"], timeCap(900)],
    ["TIME", ["20 MINUTE CAP"], timeCap(1200)],
    ["TIME", ["20 Minute Cap."], timeCap(1200)],
    ["TIME", ["3 sets,1 set every 4:00"], setTimer(3, 240)],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(sectionTimerOf(badge, notes)).toEqual(expected);
  });
});

describe("10.7 AC44 — a badge line's text", () => {
  it.each([
    ["rounds / reps", "ROUNDS/REPS"],
    ["TIME", "TIME"],
    ["No Score", "NO SCORE"],
  ])("%j → %j", (line, expected) => {
    expect(cleanWorkoutText(`Main\n${line}\n10 Squats`).badges.flat()).toContain(expected);
  });

  it("an untagged line has no badges", () => {
    expect(cleanWorkoutText("Main\nTIME\n10 Squats").badges).toEqual([["TIME"], []]);
  });
});

/** The raw paste of several screenshots, each opened by its own clock line. */
const shots = (...screens: string[][]) => screens.map((lines, i) => [`11:0${i + 1}`, ...lines].join("\n")).join("\n");

describe("#270 — an overlap twin's badge reaches #267's choice", () => {
  it("the removed twin's TIME joins the kept copy's REPS → Time Cap", () => {
    const raw = shots(["Strength", "NO SCORE", "5 Squats", "Main", "REPS"], ["Main", "TIME", "21-15-9", "Thrusters", "15 Minute Cap"]);
    const c = cleanWorkoutText(raw);
    expect(c.lines.filter((l) => l === "Main")).toHaveLength(1);
    expect(c.badges[c.lines.indexOf("Main")]).toEqual(["REPS", "TIME"]);
    expect(readWorkoutText(raw).sections.find((s) => s.name === "Main")!.timer).toEqual(timeCap(900));
  });

  it("a cut-off header's badge goes before the full line's", () => {
    const c = cleanWorkoutText(shots(["Strength", "NO SCORE", "5 Squats", "Part B", "REPS"], ["Part B Strength", "TIME", "15 Minute Cap"]));
    expect(c.lines).not.toContain("Part B");
    expect(c.badges[c.lines.indexOf("Part B Strength")]).toEqual(["REPS", "TIME"]);
  });

  it("code review: badges stacked under one header in one screenshot are one badge, parts joined (REPS + TIME → REPS/TIME)", () => {
    const raw = ["Main", "REPS", "TIME", "15 Minute Cap", "10 Squats"].join("\n");
    expect(cleanWorkoutText(raw).badges).toEqual([["REPS/TIME"], [], []]);
    expect(readWorkoutText(raw).sections[0]!.timer).toEqual(timeCap(900));
  });

  it("code review: stacked TIME + ROUNDS reads like TIME/ROUNDS, so no timer (AC45)", () => {
    const raw = ["Main", "TIME", "ROUNDS", "AMRAP 12", "15 Minute Cap"].join("\n");
    expect(cleanWorkoutText(raw).badges[0]).toEqual(["TIME/ROUNDS"]);
    expect(readWorkoutText(raw).sections[0]!.timer).toBeUndefined();
  });

  it("code review: a badge in the next screenshot is still a separate badge, not stacked", () => {
    expect(cleanWorkoutText(shots(["Intro", "Main", "REPS"], ["TIME", "15 Minute Cap"])).badges[1]).toEqual(["REPS", "TIME"]);
  });

  it("Review Focus 5: the same badge on both copies is listed once", () => {
    const c = cleanWorkoutText(shots(["Strength", "NO SCORE", "5 Squats", "Main", "REPS"], ["Main", "REPS", "10 Lunges"]));
    expect(c.badges[c.lines.indexOf("Main")]).toEqual(["REPS"]);
  });
});

describe("#273 — a badge that times nothing isn't overruled by a Score: line", () => {
  it("REPS with `Score: Time to complete.` and a cap line → no timer (AC45: the badge wins)", () => {
    const r = readWorkoutText(shots(["Main", "REPS", "Score: Time to complete.", "15 Minute Cap"]));
    expect(r.sections[0]!.timer).toBeUndefined();
  });
});

describe("#266 — badgeText is not part of @sin/core", () => {
  it("the barrel has no badgeText", async () => {
    expect(Object.keys(await import("../src/index.js"))).not.toContain("badgeText");
  });
});

describe("#261 — gym phrasings (owner ruling 2026-11-04)", () => {
  it.each<[string, string[], SectionTimer]>([
    ["ROUNDS/REPS", ["12 Min AMRAP:"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12:"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12 Min:"], amrap(720)],
    ["ROUNDS/REPS", ["12-Minute AMRAP"], amrap(720)],
    ["ROUNDS/REPS", ["12 Min. AMRAP"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12:30"], amrap(750)],
    ["TIME", ["15-Minute Cap"], timeCap(900)],
    ["TIME", ["15 Min. Cap"], timeCap(900)],
    ["TIME", ["15 Min Cap:"], timeCap(900)],
    ["TIME", ["Time Cap - 15:00"], timeCap(900)],
    ["TIME", ["Time Cap – 15"], timeCap(900)],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(sectionTimerOf(badge, notes)).toEqual(expected);
  });

  it.each<[string, string[]]>([
    ["ROUNDS/REPS", ["12 Min AMRAP: 10 Burpees"]], // Review Focus 1: whole-line only
    ["ROUNDS/REPS", ["AMRAP 12:3"]], // Review Focus 5: never half a clock
    ["TIME", ["Time Cap -"]],
    ["TIME", ["15--Minute Cap"]],
  ])("%j %j → no timer", (badge, notes) => {
    expect(sectionTimerOf(badge, notes)).toBeNull();
  });
});

describe("#271 — every dash form (owner ruling 2026-11-05)", () => {
  it.each<[string, string[], SectionTimer]>([
    ["TIME", ["15–Minute Cap"], timeCap(900)],
    ["TIME", ["15 Min.Cap"], timeCap(900)],
    ["TIME", ["Time Cap 15-Minutes"], timeCap(900)],
    ["ROUNDS/REPS", ["AMRAP - 12"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP – 12"], amrap(720)],
    ["ROUNDS/REPS", ["AMRAP 12-Minute"], amrap(720)],
    ["ROUNDS/REPS", ["12–Minute AMRAP"], amrap(720)],
    ["ROUNDS/REPS", ["12 Min.AMRAP"], amrap(720)],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(sectionTimerOf(badge, notes)).toEqual(expected);
  });

  it.each<[string, string[]]>([
    ["ROUNDS/REPS", ["AMRAP 12-"]], // Review Focus 1: half a dash form
    ["ROUNDS/REPS", ["AMRAP -"]],
    ["TIME", ["15– Cap"]],
    ["TIME", ["15 MinCap"]], // no space only right after the period
  ])("%j %j → no timer", (badge, notes) => {
    expect(sectionTimerOf(badge, notes)).toBeNull();
  });

  it("Review Focus 3: `AMRAP - 12` between movements is a note and the run stays open", () => {
    const r = readWorkoutText(["Main", "ROUNDS/REPS", "3 Rounds", "10 Burpees", "AMRAP - 12", "5 Squats"].join("\n"));
    expect(r.items.map((i) => i.name)).toEqual(["Burpees", "Squats"]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
    expect(r.sections[0]!.timer).toEqual(amrap(720));
  });
});

describe("#275 — a Set Timer line takes a trailing colon (owner ruling 2026-11-05)", () => {
  it("TIME / `3 Sets, 1 Set Every 4:00:` → Set Timer 3 × 4:00", () => {
    expect(sectionTimerOf("TIME", ["3 Sets, 1 Set Every 4:00:"])).toEqual(setTimer(3, 240));
  });

  it("reads end to end, with the line kept in the note", () => {
    const r = readWorkoutText(["Main", "TIME", "3 Sets, 1 Set Every 4:00:", "10 Squats"].join("\n"));
    expect(r.sections[0]!.timer).toEqual(setTimer(3, 240));
    expect(r.sections[0]!.notes).toContain("3 Sets, 1 Set Every 4:00:");
  });

  it("Review Focus 2: content after the colon → no timer", () => {
    expect(sectionTimerOf("TIME", ["3 Sets, 1 Set Every 4:00: 10 Squats"])).toBeNull();
  });
});

describe("#276 — a double-bulleted cap line times its section", () => {
  it("in a run: a note, the run stays open, Time Cap 15:00", () => {
    const r = readWorkoutText(["Main", "TIME", "21-15-9", "Thrusters", "- - 15 Minute Cap", "Pull-ups"].join("\n"));
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(r.sections[0]!.notes).toContain("- - 15 Minute Cap");
    expect(r.sections[0]!.timer).toEqual(timeCap(900));
  });

  it("outside a run too", () => {
    expect(sectionTimerOf("TIME", ["- - 15 Minute Cap"])).toEqual(timeCap(900));
  });

  it("Review Focus 4: a double-bulleted movement in a run reads as today", () => {
    const r = readWorkoutText(["Main", "TIME", "21-15-9", "Thrusters", "- - 15 Burpees", "Pull-ups"].join("\n"));
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "- 15 Burpees", "Pull-ups"]);
  });
});

describe("#265 — a bulleted timer line", () => {
  it.each<[string, string[], SectionTimer]>([
    ["TIME", ["- For Time"], timeCap(null)],
    ["TIME", ["• For Time:"], timeCap(null)],
    ["TIME", ["- 15 Minute Cap"], timeCap(900)],
    ["ROUNDS/REPS", ["* AMRAP 15"], amrap(900)],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(sectionTimerOf(badge, notes)).toEqual(expected);
  });

  it("reads end to end: Main / TIME / - For Time / - 50 Burpees / - 20 Pull-ups", () => {
    const read = readWorkoutText(["Main", "TIME", "- For Time", "- 50 Burpees", "- 20 Pull-ups"].join("\n"));
    expect(read.sections[0]!.timer).toEqual(timeCap(null));
    expect(read.sections[0]!.notes).toContain("- For Time"); // D10: the line stays in the note
  });
});

describe("#264 — the exported functions normalize their input", () => {
  it("a lowercase or spaced badge scores like the reader's form", () => {
    expect(scoreKindOf("time", [])).toBe("time");
    expect(scoreKindOf("rounds / reps", [])).toBe("rounds-reps");
    expect(sectionTimerOf("rounds/reps", ["AMRAP   15"])).toEqual(amrap(900));
  });

  it("a long uncollapsed whitespace run stays fast (#274)", () => {
    const start = performance.now();
    expect(sectionTimerOf("TIME", [`Time cap${" ".repeat(200_000)}x`])).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("#272 — scoreKindOf strips bullets like sectionTimerOf", () => {
  it.each<[string | null, string[], ScoreKind | null]>([
    [null, ["- Score: Time"], "time"],
    [null, ["• Score: Total rounds + reps."], "rounds-reps"],
    ["TIME", ["- Score: Total rounds"], "time"],
  ])("%j %j → %j", (badge, notes, expected) => {
    expect(scoreKindOf(badge, notes)).toBe(expected);
  });
});

describe("#262 — a cap or AMRAP line after the movements is a note", () => {
  const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

  it("For Time: / 21-15-9 / Thrusters / Pull-ups / 15 Minute Cap → Time Cap 15:00, two exercises", () => {
    const r = read(["Main", "TIME", "For Time:", "21-15-9", "Thrusters", "Pull-ups", "15 Minute Cap"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(r.sections[0]!.timer).toEqual(timeCap(900));
    expect(r.sections[0]!.notes).toContain("15 Minute Cap");
  });

  it("3 Rounds / 10 Burpees / AMRAP 15 → AMRAP 15:00, one exercise", () => {
    const r = read(["Main", "ROUNDS/REPS", "3 Rounds", "10 Burpees", "AMRAP 15"]);
    expect(r.items.map((i) => i.name)).toEqual(["Burpees"]);
    expect(r.sections[0]!.timer).toEqual(amrap(900));
  });

  it("Review Focus 2: the run stays open after the cap line", () => {
    const r = read(["Main", "TIME", "21-15-9", "Thrusters", "15 Minute Cap", "Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
  });

  it("Review Focus 3: in a weight-scored section the line is a note and there is no timer", () => {
    const r = read(["Main", "REPS", "3 Rounds", "10 Squats", "20 Minute Cap"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats"]);
    expect(r.sections[0]!.timer).toBeUndefined();
    expect(r.sections[0]!.notes).toContain("20 Minute Cap");
  });
});

describe("#267 — a repeated header's different badge (owner ruling 2026-11-04)", () => {
  const shots = (...screens: string[][]) => readWorkoutText(screens.map((lines, i) => [`11:0${i + 1}`, ...lines].join("\n")).join("\n"));

  it("REPS on the first copies, TIME on a later one, with a cap line → Time Cap", () => {
    const r = shots(["Main", "REPS", "21-15-9", "Thrusters"], ["Main", "REPS", "Pull-ups"], ["Main", "TIME", "15 Minute Cap"]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.timer).toEqual(timeCap(900));
  });

  it("Review Focus 4: badges that time nothing keep the first (today's)", () => {
    const r = shots(["Main", "REPS", "3 Rounds", "10 Squats"], ["Main", "NO SCORE", "10 Lunges"]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.timer).toBeUndefined();
  });

  it("a TIME first copy and a later REPS copy still time the section", () => {
    const r = shots(["Main", "TIME", "21-15-9", "Thrusters"], ["Main", "REPS", "15 Minute Cap"]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.timer).toEqual(timeCap(900));
  });
});

describe("#262 final review — only a line that would have been an exercise becomes a note", () => {
  const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

  it("untimed: `Time cap: 12:00` still closes the run, so the next title heads its own section", () => {
    const r = read(["Metcon", "3 Rounds", "10 Squats", "10 Lunges", "Time cap: 12:00", "Core Finisher", "3 Rounds", "20 Sit-ups"]);
    expect(r.sections.map((s) => s.name)).toEqual(["Metcon", "Core Finisher"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats", "Lunges", "Sit-ups"]);
  });

  it("`Time Cap: 10:00` after a scheme leaves `Accessory Work` a title, not an exercise", () => {
    const r = read(["21-15-9", "Thrusters", "Pull-ups", "Time Cap: 10:00", "Accessory Work", "3 Sets", "10 Curls"]);
    expect(r.items.map((i) => i.name)).not.toContain("Accessory Work");
  });

  it("weight-scored: the line after `Time cap: 12:00` is not folded into the run", () => {
    const r = read(["Main", "REPS", "3 Rounds", "10 Squats", "Time cap: 12:00", "50 Double Unders"]);
    const [squats, du] = r.items;
    expect(du!.name).toBe("Double Unders");
    expect(du!.run).not.toBe(squats!.run);
  });

  it.each(["AMRAP 12:", "12 Min AMRAP:"])("`%s` after the movements starts a new block, as `For Time:` does (minor 280)", (line) => {
    const r = read(["Main", "ROUNDS/REPS", "2 Rounds", "10 Squats", "10 Lunges", line, "5 Pull-ups", "10 Push-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats", "Lunges", "Pull-ups", "Push-ups"]);
    expect(r.items[2]!.run).not.toBe(r.items[0]!.run);
  });

  it("`12 Min AMRAP:` after a For Time scheme: the movements after it keep their reps", () => {
    const r = read(["Main", "TIME", "For Time:", "21-15-9", "Thrusters", "Pull-ups", "12 Min AMRAP:", "10 Burpees", "10 Squats"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups", "Burpees", "Squats"]);
    expect(r.items[2]!.run).not.toBe(r.items[0]!.run);
  });
});

describe("#279 — only a label colon ends the run (owner ruling 2026-11-05)", () => {
  const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

  it.each<[string, string, SectionTimer]>([
    ["TIME", "15 Min. Cap", timeCap(900)],
    ["TIME", "15 Min.Cap", timeCap(900)],
    ["TIME", "15 Minute Cap.", timeCap(900)],
    ["TIME", "Time Cap 15-Min.", timeCap(900)],
    ["TIME", "Time Cap 12:00", timeCap(720)],
    ["TIME", "Time Cap - 12:00", timeCap(720)],
    ["ROUNDS/REPS", "12 Min.AMRAP", amrap(720)],
    ["ROUNDS/REPS", "AMRAP 12:00", amrap(720)],
  ])("%s / 21-15-9 / Thrusters / %s / Pull-ups → one run, the line in the note", (badge, line, timer) => {
    const r = read(["Main", badge, "21-15-9", "Thrusters", line, "Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
    expect(r.sections[0]!.notes).toBe(line);
    expect(r.sections[0]!.timer).toEqual(timer);
  });

  it.each<[string, string]>([
    ["TIME", "Time cap: 12:00"],
    ["TIME", "Time Cap: 15"],
    ["TIME", "15 Minute Cap:"],
    ["ROUNDS/REPS", "AMRAP: 12"],
    ["ROUNDS/REPS", "AMRAP 12:"],
  ])("%s: `%s` is a label and still ends the run (#262)", (badge, line) => {
    const r = read(["Main", badge, "21-15-9", "Thrusters", line, "Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters"]);
    expect(r.sections[0]!.notes).toContain("Pull-ups");
  });

  it("Review Focus 1: with badges, a title after the cap line still heads its section", () => {
    const r = read(["Metcon", "TIME", "3 Rounds", "10 Squats", "Time Cap 12:00", "Core Finisher", "NO SCORE", "3 Rounds", "20 Sit-ups"]);
    expect(r.sections.map((s) => s.name)).toEqual(["Metcon", "Core Finisher"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats", "Sit-ups"]);
  });

  it("Review Focus 2: a cap line before the first movement keeps the run", () => {
    const r = read(["Main", "TIME", "21-15-9", "Time Cap 12:00", "Thrusters", "Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
  });

  it("Review Focus 3: an out-of-range cap keeps the run and times nothing", () => {
    const r = read(["Main", "TIME", "21-15-9", "Thrusters", "Time Cap 200:00", "Pull-ups"]);
    expect(r.items.map((i) => i.name)).toEqual(["Thrusters", "Pull-ups"]);
    expect(r.sections[0]!.timer).toBeUndefined();
  });

  it("Review Focus 4: in a weight-scored section the run stays open and there is no timer", () => {
    const r = read(["Main", "REPS", "3 Rounds", "10 Squats", "Time Cap 12:00", "10 Lunges"]);
    expect(r.items.map((i) => i.name)).toEqual(["Squats", "Lunges"]);
    expect(new Set(r.items.map((i) => i.run)).size).toBe(1);
    expect(r.sections[0]!.timer).toBeUndefined();
  });
});
