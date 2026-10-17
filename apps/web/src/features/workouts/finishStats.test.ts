import { describe, expect, it } from "vitest";

import { finishStatsFor, formatMinutes, workingSetCount, workoutMinutes, workoutVolumeKg } from "./finishStats";

const set = (setType: string, reps: number | null = 5, weightKg: number | null = 100) => ({ setType, reps, weightKg });
const ex = (modalitySnapshot: string, sets: ReturnType<typeof set>[]) => ({ modalitySnapshot, sets });

describe("17.2 AC4 / AC5 — sets are logged working sets only", () => {
  it("6 warm-ups and 3 working sets read 3", () => {
    const sets = [...Array.from({ length: 6 }, () => set("warmup")), ...Array.from({ length: 3 }, () => set("working"))];
    expect(workingSetCount([ex("weight_reps", sets)])).toBe(3);
  });
  it("drop and failure sets are not counted; nothing logged is 0", () => {
    expect(workingSetCount([ex("weight_reps", [set("drop"), set("failure"), set("working")])])).toBe(1);
    expect(workingSetCount([])).toBe(0);
  });
  it("sums across exercises", () => {
    expect(workingSetCount([ex("weight_reps", [set("working")]), ex("weight_reps", [set("working"), set("working")])])).toBe(3);
  });
});

describe("17.2 AC6 — duration", () => {
  const start = "2026-10-17T10:00:00.000Z";
  const plus = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
  it("rounds to whole minutes, half up", () => {
    expect(workoutMinutes(start, plus(52 * 60_000))).toBe(52);
    expect(workoutMinutes(start, plus(30_000))).toBe(1);
    expect(workoutMinutes(start, plus(29_999))).toBe(0);
  });
  it("never reads negative with a skewed clock", () => {
    expect(workoutMinutes(plus(60_000), start)).toBe(0);
  });
  it.each([
    [0, "Under 1 min"],
    [1, "1 min"],
    [59, "59 min"],
    [60, "1 h"],
    [65, "1 h 5 min"],
    [120, "2 h"],
    [125, "2 h 5 min"],
  ])("%i minutes reads %s", (n, text) => {
    expect(formatMinutes(n)).toBe(text);
  });
});

describe("17.2 AC9 / AC11 — volume", () => {
  it("is the working-set sum in kg, with a warm-up adding nothing", () => {
    expect(workoutVolumeKg([ex("weight_reps", [set("working", 5, 100), set("warmup", 5, 60)])])).toBe(500);
  });
  it("has no float residue", () => {
    expect(workoutVolumeKg([ex("weight_reps", [set("working", 5, 82.5)])])).toBe(412.5);
  });
  it("is null, never 0, for bodyweight-only and duration workouts", () => {
    expect(workoutVolumeKg([ex("bodyweight_reps", [set("working", 20, null)])])).toBeNull();
    expect(workoutVolumeKg([ex("duration", [set("working", null, null)])])).toBeNull();
    expect(workoutVolumeKg([])).toBeNull();
  });
});

describe("17.2 AC4 — finishStatsFor combines them", () => {
  it("returns minutes, exercise count, working sets and volume", () => {
    const startedAt = "2026-10-17T10:00:00.000Z";
    const stats = finishStatsFor({ startedAt, exercises: [ex("weight_reps", [set("working", 5, 100), set("warmup")]), ex("weight_reps", [set("working", 5, 100)])] }, "2026-10-17T10:41:00.000Z");
    expect(stats).toEqual({ minutes: 41, exercises: 2, sets: 2, volumeKg: 1000 });
  });
});
