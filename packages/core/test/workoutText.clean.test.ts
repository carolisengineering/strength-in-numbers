import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanWorkoutText, collapseLine, isFurnitureLine, isIconLine, ocrKey } from "../src/workoutText.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-19.txt");
const FIXTURE_24 = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-24.txt");

describe("10.4 AC2 — furniture lines are dropped by exact whole-line match", () => {
  it.each(["11:41", "7:05 PM", "07:05pm", "  no   score ", "Weight", "TIME", "REPS", "ROUNDS", "DISTANCE", "CALORIES", "LOAD",
           "RESULTS (5)", "results (12)", "Log result", "HIRAYA TRAINING HOUSE", "Hiraya", "TRAINING HOUSE", "Home", "schedule", "Workouts", "Social"])("%s is furniture", (line) => expect(isFurnitureLine(line)).toBe(true));
  it.each(["For Time:", "Push Press", "Weight training", "Time under tension 3:00", "Home stretch", "Results are mixed", "RESULTS", "11:41 Run"])("%s survives", (line) => expect(cleanWorkoutText(`Intro\n${line}`).lines).toContain(collapseLine(line)));
});

describe("10.4 AC3 — screenshot boundaries at clock lines", () => {
  it("no clock line → one chunk, no overlap removal", () => {
    expect(cleanWorkoutText("A b\nA b").lines).toEqual(["A b", "A b"]);
    expect(cleanWorkoutText("A b\nA b").chunks).toBe(1);
  });
  it("text before the first clock is its own chunk; a chunk of only furniture is not counted", () => {
    expect(cleanWorkoutText("Intro\n11:41\nWarmup\n11:42\nHome\nSocial").chunks).toBe(2);
  });
  it("crlf, lone cr and blank lines split like \\n", () => {
    expect(cleanWorkoutText("A\r\nB\rC\n\n  \nD").lines).toEqual(["A", "B", "C", "D"]);
  });
  it("control characters become spaces", () => expect(cleanWorkoutText("Push\u0007Press\tNow").lines).toEqual(["Push Press Now"]));
  it("non-breaking and zero-width spaces collapse like spaces", () =>
    expect(cleanWorkoutText("Push ​Press﻿").lines).toEqual(["Push Press"]));
});

describe("10.4 AC4 — overlap removal at boundaries only", () => {
  it("k = 1", () => expect(cleanWorkoutText("11:41\nX one\nStrict Press\n11:42\nStrict Press\nHeavy 10").lines).toEqual(["X one", "Strict Press", "Heavy 10"]));
  it("k = 2", () => expect(cleanWorkoutText("11:41\nA a\nP one\nP two\n11:42\nP one\nP two\nC c").lines).toEqual(["A a", "P one", "P two", "C c"]));
  it("fragment suffix (≥ 2 words)", () => expect(cleanWorkoutText("11:41\nBut we get to use our legs.\n11:43\nour legs.\nNext").lines).toEqual(["But we get to use our legs.", "Next"]));
  it("a one-word suffix is not a fragment", () => expect(cleanWorkoutText("11:41\nuse our legs.\n11:43\nlegs.").lines).toEqual(["use our legs.", "legs."]));
  it("a suffix that starts mid-word is not a fragment", () => expect(cleanWorkoutText("11:41\nuse your legs.\n11:43\nour legs.").lines).toEqual(["use your legs.", "our legs."]));
  it("fragment prefix: A's cut-off last line gives way to B's full line", () =>
    expect(cleanWorkoutText("11:41\nAlpha\nManage your effort early\n11:42\nManage your effort early, keep transitions short.").lines)
      .toEqual(["Alpha", "Manage your effort early, keep transitions short."]));
  it("repeats inside a chunk or away from a boundary stay", () =>
    expect(cleanWorkoutText("11:41\n21-15-9\nPower Clean\n21-15-9\n11:42\nPush Press\n21-15-9").lines).toEqual(["21-15-9", "Power Clean", "21-15-9", "Push Press", "21-15-9"]));
  it("the example's three boundaries", () => {
    const r = cleanWorkoutText(readFileSync(FIXTURE, "utf8"));
    expect(r).toMatchObject({ chunks: 5, input: 98, furniture: 40, overlap: 4 });
    expect(r.lines).toHaveLength(54);
    expect(r.lines.filter((l) => l === "Strict Press")).toHaveLength(1);
    expect(r.lines).not.toContain("our legs.");
    expect(r.lines.filter((l) => l.startsWith("Today we're building"))).toHaveLength(1);
  });
});

describe("10.4 AC42 — a clock line may carry one icon", () => {
  it.each(["11:08 →", "11:09 |", "11:09 -", "9:41 AM •"])("%s splits screenshots", (clock) =>
    expect(cleanWorkoutText(`Intro\n${clock}\nNext`).chunks).toBe(2));
  it.each(["1:30 on / 1:30 Rest", "3:00 Rest", "2:00 Machine Choice", "11:41 Run"])("%s is text, not a clock (Review Focus 1)", (line) => {
    const r = cleanWorkoutText(`Intro\n${line}`);
    expect(r.chunks).toBe(1);
    expect(r.lines).toContain(line);
  });
  it("the 2026-10-24 paste cleans to 4 screenshots", () => expect(cleanWorkoutText(readFileSync(FIXTURE_24, "utf8")).chunks).toBe(4));
});

describe("10.4 AC43 — icon and count lines are furniture", () => {
  it.each(["→", "•0ll", "•ll", "★"])("%s is dropped and counted anywhere", (line) => {
    expect(isIconLine(line)).toBe(true);
    const r = cleanWorkoutText(`Intro\n${line}\nNext`);
    expect(r.lines).toEqual(["Intro", "Next"]);
    expect(r.furniture).toBe(1);
  });
  it.each([
    ["before a tab-bar line", "Intro\nNext\n{}\nHome"],
    ["after a tab-bar line", "Intro\nNext\nWorkouts\n{}\nSocial"],
    ["within two lines of the clock", "11:09\nIntro\n{}\nNext"],
  ])("a short line of letters in another script is an icon %s (item 71)", (_, text) => {
    for (const icon of ["口", "凸", "الهه"]) {
      expect(isIconLine(icon)).toBe(false);
      expect(cleanWorkoutText(text.replace("{}", icon)).lines).not.toContain(icon);
    }
  });
  it.each(["Жим", "スクワット", "الهه"])("%s mid-list is someone's exercise, not an icon (item 71)", (line) =>
    expect(cleanWorkoutText(`11:08\nStrength\n3 Sets:\n10 Push-ups\n${line}\n10 Squats`).lines).toContain(line));
  it.each(["Søren Lunge", "Row", "10", "I", "Lo", "100m", "***", "---", "+", "|"])("%s is kept (Review Focus 2; plain ASCII marks are separators, not icons)", (line) => {
    expect(isIconLine(line)).toBe(false);
    expect(cleanWorkoutText(`Intro\n${line}`).lines).toContain(line);
  });
  it.each(["今日はスピードとパワーの日です。", "-".repeat(40), "\u0000\ud800" + "-".repeat(2_000)])("a long line with no Latin letter is text, not an icon: %#", (line) =>
    expect(isIconLine(line)).toBe(false));
  it("a bare number right after RESULTS (n) is dropped; elsewhere it stays", () => {
    expect(cleanWorkoutText("Intro\nRESULTS (2)\n49\nAccessory").lines).toEqual(["Intro", "Accessory"]);
    expect(cleanWorkoutText("Intro\n49\nAccessory").lines).toEqual(["Intro", "49", "Accessory"]);
  });
});

describe("10.4 AC44 — the overlap tolerates OCR look-alikes", () => {
  it("gos and g0s share a key; different numbers do not (Review Focus 3)", () => {
    expect(ocrKey("In a gos Time window,")).toBe(ocrKey("In a g0s Time window,"));
    expect(ocrKey("In a 90s Time window,")).toBe(ocrKey("In a gos  Time window,"));
    expect(ocrKey("Set 1")).not.toBe(ocrKey("Set 2"));
    expect(ocrKey("10 Reps")).not.toBe(ocrKey("12 Reps"));
  });
  it("case is kept except for letters whose two cases look alike (item 72)", () => {
    expect(ocrKey("1:30 on / 1:30 REST")).not.toBe(ocrKey("1:30 on / 1:30 Rest"));
    expect(ocrKey("Cross Over")).toBe(ocrKey("CrOss over"));
    const r = cleanWorkoutText("11:08\nIntro\n1:30 on / 1:30 REST\n11:09\n1:30 on / 1:30 Rest\nNext");
    expect(r.lines).toEqual(["Intro", "1:30 on / 1:30 REST", "1:30 on / 1:30 Rest", "Next"]);
    expect(r.overlap).toBe(0);
  });
  it("a 6-line overlap differing by one look-alike is removed from the second screenshot; the first's text is kept", () => {
    const a = ["Head line", "10x 90s on / 90s Rest", "10 Sets, 1 Set Every 3:00", "90s on / 90s Rest", "In a gos Time window,", "200 Meter Run+"];
    const b = ["10x 90s on / 90s Rest", "10 Sets, 1 Set Every 3:00", "90s on / 90s Rest", "In a g0s Time window,", "200 Meter Run+", "Max Cal Echo Bike"];
    const r = cleanWorkoutText(["11:08", "Intro", ...a, "11:09 →", ...b].join("\n"));
    expect(r.lines).toEqual(["Intro", ...a, "Max Cal Echo Bike"]);
    expect(r.overlap).toBe(5);
  });
});

describe("10.4 AC45 — tagged headers survive cleaning", () => {
  const taggedOf = (path: string) => {
    const r = cleanWorkoutText(readFileSync(path, "utf8"));
    expect(r.tagged).toHaveLength(r.lines.length);
    return r.lines.filter((_, i) => r.tagged[i]);
  };
  it("2026-10-24: Warmup, the workout and Accessory, once each", () =>
    expect(taggedOf(FIXTURE_24)).toEqual(["Warmup", `Workout: "Don't Let up"`, "Accessory"]));
  it("2026-10-19: its four headers", () =>
    expect(taggedOf(FIXTURE)).toEqual(["Warmup", "Strict Press", 'Workout: " Second Shift"', "Accessory"]));
  it("a header cut off above its badge keeps the tag of its twin removed as overlap (Review Focus 4)", () => {
    const r = cleanWorkoutText("11:08\nIntro line\nAccessory\n11:09 →\nAccessory\nNO SCORE\n3 Sets:");
    expect(r.lines).toEqual(["Intro line", "Accessory", "3 Sets:"]);
    expect(r.tagged).toEqual([false, true, false]);
  });
  it("a cut-off header dropped from the first screenshot hands its tag to the full line that stays (item 75)", () => {
    const r = cleanWorkoutText("11:08\nIntro\nFront Rack\nREPS\n11:09\nFront Rack Carry\n3 Sets:");
    expect(r.lines).toEqual(["Intro", "Front Rack Carry", "3 Sets:"]);
    expect(r.tagged).toEqual([false, true, false]);
  });
  it("Log result does not tag the line above it", () => expect(cleanWorkoutText("Intro\nLog result").tagged).toEqual([false]));
});
