import type { DistanceUnit } from "@sin/core";
import { describe, expect, it } from "vitest";

import { parseDraft, type SetDraft } from "./setDraft";
import { DISTANCE_STEP, distanceAtLimit, stepDistance } from "./stepper";

const draft = (distance: string, distanceUnit: DistanceUnit): SetDraft => ({
  weight: "24", reps: "", distance, minutes: "", seconds: "", rpe: "", calories: "", weightUnit: "kg", distanceUnit, setType: "working", attemptKey: "k1",
});

describe("17.8 AC12 — stepDistance", () => {
  it("steps 10 for m and ft, 0.1 for km and mi", () => {
    expect(DISTANCE_STEP).toEqual({ m: 10, ft: 10, km: 0.1, mi: 0.1 });
    expect(stepDistance("40", "m", "up")).toBe("50");
    expect(stepDistance("40", "ft", "down")).toBe("30");
    expect(stepDistance("2", "mi", "up")).toBe("2.1");
  });

  it("steps in milli-units, so 0.1 + 0.1 + 0.1 is exactly 0.3 (Review Focus 3)", () => {
    expect(stepDistance("0.1", "km", "up")).toBe("0.2");
    expect(stepDistance("0.2", "km", "up")).toBe("0.3");
  });

  it("reads a comma-typed value (Review Focus 3)", () => {
    expect(stepDistance("1,5", "km", "up")).toBe("1.6");
  });

  it("steps from 0 when blank and floors at 0", () => {
    expect(stepDistance("", "m", "up")).toBe("10");
    expect(stepDistance("", "km", "up")).toBe("0.1");
    expect(stepDistance("0.05", "km", "down")).toBe("0");
  });
});

describe("17.8 AC12 — distanceAtLimit", () => {
  it("down is at its limit blank and at 0", () => {
    expect(distanceAtLimit("", "m", "down")).toBe(true);
    expect(distanceAtLimit("0", "km", "down")).toBe(true);
    expect(distanceAtLimit("10", "m", "down")).toBe(false);
  });

  it("up is at its limit when the next value would pass SET_DISTANCE_MAX in meters", () => {
    expect(distanceAtLimit("999990", "m", "up")).toBe(true);
    expect(distanceAtLimit("999980", "m", "up")).toBe(false);
    expect(distanceAtLimit("999.95", "km", "up")).toBe(true);
    expect(distanceAtLimit("999.8", "km", "up")).toBe(false);
    expect(distanceAtLimit("621.3", "mi", "up")).toBe(true);
    expect(distanceAtLimit("621.2", "mi", "up")).toBe(false);
  });

  it("Review Focus 1: up in ft is at its limit by the entered-value bound, though its meters are far under", () => {
    expect(distanceAtLimit("999995", "ft", "up")).toBe(true);
    expect(stepDistance("999995", "ft", "up")).toBe("999995");
  });

  it.each<[string, DistanceUnit]>([
    ["999980", "m"],
    ["999985", "ft"],
    ["999.8", "km"],
    ["621.2", "mi"],
    ["", "m"],
    ["3", "km"],
  ])("a step up from %j %s that isn't at its limit gives text parseDraft accepts", (text, unit) => {
    expect(distanceAtLimit(text, unit, "up")).toBe(false);
    expect(parseDraft("weight_distance", draft(stepDistance(text, unit, "up"), unit)).ok).toBe(true);
  });

  it("a step down from a value typed past the limit lands on a value parseDraft accepts", () => {
    for (const [text, unit] of [["2000000", "m"], ["5000", "km"], ["700", "mi"], ["2000000", "ft"]] as const) {
      expect(parseDraft("weight_distance", draft(stepDistance(text, unit, "down"), unit)).ok, `${text} ${unit}`).toBe(true);
    }
  });
});
