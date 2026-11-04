import { describe, expect, it } from "vitest";
import { SectionTimerSchema, type SectionTimer } from "../src/dto/section-timer.js";
import { badgeText, readWorkoutText, scoreKindOf, sectionTimerOf, type ScoreKind } from "../src/workoutText.js";
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

describe("10.7 AC44 — badgeText", () => {
  it.each([
    ["rounds / reps", "ROUNDS/REPS"],
    ["TIME", "TIME"],
    ["No Score", "NO SCORE"],
  ])("%j → %j", (line, expected) => {
    expect(badgeText(line)).toBe(expected);
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

  it("a long uncollapsed whitespace run stays fast", () => {
    const start = performance.now();
    expect(sectionTimerOf("TIME", [`Time cap${" ".repeat(50_000)}x`])).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
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
