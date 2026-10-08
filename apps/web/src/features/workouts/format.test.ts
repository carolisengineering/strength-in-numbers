import { describe, expect, it } from "vitest";
import type { Modality } from "@sin/core";
import { makeSet } from "../../test/workoutFixtures";
import { formatDuration, formatLocalDate, formatSet } from "./format";

describe("AC8 — formatSet and formatDuration", () => {
  const none = { reps: null, weight: null, weightUnit: null, durationS: null, distance: null, distanceUnit: null };

  it.each<[Modality, Record<string, unknown>, string]>([
    ["weight_reps", { weight: 60, reps: 8 }, "60 kg × 8"],
    ["bodyweight_reps", { ...none, reps: 12 }, "12 reps"],
    ["weighted_bodyweight", { weight: 10, reps: 8 }, "+10 kg × 8"],
    ["duration", { ...none, durationS: 90 }, "1:30"],
    ["distance_duration", { ...none, distance: 5, distanceUnit: "km", durationS: 1500 }, "5 km · 25:00"],
  ])("%s", (modality, overrides, text) => {
    expect(formatSet(makeSet(overrides), modality)).toBe(text);
  });

  it("appends RPE and a label for a non-working type", () => {
    expect(formatSet(makeSet({ rpe: 8 }), "weight_reps")).toBe("60 kg × 8 @8");
    expect(formatSet(makeSet({ setType: "warmup" }), "weight_reps")).toBe("60 kg × 8 (Warm-up)");
    expect(formatSet(makeSet({ setType: "failure", reps: 0 }), "weight_reps")).toBe("60 kg × 0 (Failure)");
  });

  it("renders – for a null measure and prints no trailing .000", () => {
    expect(formatSet(makeSet({ weight: null, isComplete: false }), "weight_reps")).toBe("– × 8");
    expect(formatSet(makeSet({ weight: 52.5 }), "weight_reps")).toBe("52.5 kg × 8");
    expect(formatSet(makeSet({ weight: 60.0 }), "weight_reps")).toBe("60 kg × 8");
    expect(formatSet(makeSet({ ...none, reps: null }), "bodyweight_reps")).toBe("–");
  });

  it.each([
    [0, "0:00"],
    [59, "0:59"],
    [60, "1:00"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("formatDuration(%i) → %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe("08.0 AC11 — formatLocalDate (shared with the summary)", () => {
  it("formats a local date in en-GB, UTC-pinned, so the stored day never shifts", () => {
    expect(formatLocalDate("2026-10-06")).toBe("Tue 6 Oct");
    expect(formatLocalDate("2026-01-01")).toBe("Thu 1 Jan");
  });
});
