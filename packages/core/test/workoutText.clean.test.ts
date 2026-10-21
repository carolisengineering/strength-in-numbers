import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanWorkoutText, collapseLine, isFurnitureLine } from "../src/workoutText.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-19.txt");

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
