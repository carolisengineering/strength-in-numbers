import { describe, expect, it } from "vitest";
import type { Modality } from "@sin/core";
import { makeSet } from "../../test/workoutFixtures";
import { formatDuration, formatLocalDate, formatSet, formatSetParts, formatStartedAt } from "./format";

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

  it("appends a label for a non-working type, and never the RPE (17.1 AC3)", () => {
    expect(formatSet(makeSet({ rpe: 8 }), "weight_reps")).toBe("60 kg × 8");
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

describe("17.1 AC39 — formatSetParts splits the type suffix", () => {
  it("core and suffix join to formatSet's text", () => {
    const set = makeSet({ weight: 40, reps: 8, setType: "warmup" });
    expect(formatSetParts(set, "weight_reps")).toEqual({ core: "40 kg × 8", typeSuffix: " (Warm-up)" });
    expect(formatSetParts(makeSet({ weight: 60, reps: 5 }), "weight_reps").typeSuffix).toBe("");
    expect(formatSet(set, "weight_reps")).toBe("40 kg × 8 (Warm-up)");
  });
});

describe("18.0 AC3 — formatStartedAt", () => {
  it("is the en-GB short date and the 24-hour time in the given zone", () => {
    expect(formatStartedAt("2026-10-14T17:05:00Z", { timeZone: "Europe/London" })).toBe("Wed 14 Oct, 18:05");
    expect(formatStartedAt("2026-10-14T23:30:00Z", { timeZone: "Europe/London" })).toBe("Thu 15 Oct, 00:30");
  });
});

describe("18.0 AC34 — the today form of formatStartedAt", () => {
  const london = { timeZone: "Europe/London" };
  it("today in the zone is the time alone; another day is the full form", () => {
    expect(formatStartedAt("2026-10-16T17:00:00Z", { ...london, today: new Date("2026-10-16T20:00:00Z") })).toBe("18:00");
    expect(formatStartedAt("2026-10-16T17:00:00Z", { ...london, today: new Date("2026-10-18T09:00:00Z") })).toBe("Fri 16 Oct, 18:00");
  });
  it("compares local days, not UTC days", () => {
    expect(formatStartedAt("2026-10-16T23:30:00Z", { ...london, today: new Date("2026-10-17T08:00:00Z") })).toBe("00:30");
  });
});

describe("05.3 AC21 — a set typed in feet displays with its unit", () => {
  it("formatSetParts of a distance_duration set in ft includes 40 ft", () => {
    const set = makeSet({ distance: 40, distanceUnit: "ft", durationS: 60, reps: null, weight: null, weightUnit: null });
    expect(formatSetParts(set, "distance_duration").core).toContain("40 ft");
  });
});
