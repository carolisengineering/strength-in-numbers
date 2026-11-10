import { SET_DURATION_S_MAX } from "@sin/core";
import { describe, expect, it } from "vitest";

import { parseDraft, type SetDraft } from "./setDraft";
import { DURATION_STEP_S, durationAtLimit, stepDuration, type StepDirection } from "./stepper";

const draft = (minutes: string, seconds: string): SetDraft => ({
  weight: "", reps: "", distance: "", minutes, seconds, rpe: "", calories: "", weightUnit: "kg", distanceUnit: "km", setType: "working", attemptKey: "k1",
});
const TOP_MINUTES = String(Math.floor(SET_DURATION_S_MAX / 60));
const TOP_SECONDS = String(SET_DURATION_S_MAX % 60);

describe("17.8 AC11 — stepDuration", () => {
  it("steps by 5 s", () => {
    expect(DURATION_STEP_S).toBe(5);
  });

  it.each<[string, string, StepDirection, { minutes: string; seconds: string }]>([
    ["", "", "up", { minutes: "0", seconds: "5" }],
    ["0", "59", "up", { minutes: "1", seconds: "4" }],
    ["1", "2", "down", { minutes: "0", seconds: "57" }],
    ["0", "3", "down", { minutes: "0", seconds: "0" }],
    // Review Focus 2: hand-typed oddities step from the total that parses, and seconds never pass 59.
    ["0", "90", "up", { minutes: "1", seconds: "35" }],
    ["abc", "10", "up", { minutes: "0", seconds: "15" }],
  ])("(%j, %j, %s) → %j, which parses", (minutes, seconds, direction, expected) => {
    const next = stepDuration(minutes, seconds, direction);
    expect(next).toEqual(expected);
    expect(parseDraft("duration", draft(next.minutes, next.seconds)).ok).toBe(true);
  });
});

describe("17.8 AC11 — durationAtLimit", () => {
  it("down is at its limit blank and at 0:00", () => {
    expect(durationAtLimit("", "", "down")).toBe(true);
    expect(durationAtLimit("0", "0", "down")).toBe(true);
    expect(durationAtLimit("0", "5", "down")).toBe(false);
  });

  it("up is at its limit at SET_DURATION_S_MAX, and a step there stays clamped", () => {
    expect(durationAtLimit(TOP_MINUTES, TOP_SECONDS, "up")).toBe(true);
    expect(durationAtLimit("1", "0", "up")).toBe(false);
    expect(stepDuration(TOP_MINUTES, TOP_SECONDS, "up")).toEqual({ minutes: TOP_MINUTES, seconds: TOP_SECONDS });
  });
});
