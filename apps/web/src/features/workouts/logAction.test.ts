import type { Modality } from "@sin/core";
import { describe, expect, it } from "vitest";

import { logLabel } from "./logAction";
import type { SetDraft } from "./setDraft";

const draft = (o: Partial<SetDraft> = {}): SetDraft => ({
  weight: "",
  reps: "",
  distance: "",
  minutes: "",
  seconds: "",
  rpe: "",
  weightUnit: "lb",
  distanceUnit: "km",
  setType: "working",
  attemptKey: "k",
  ...o,
});

describe("17.1 AC25 — logLabel follows the modality (§6.6 table)", () => {
  it.each<[string, Modality, Partial<SetDraft>, "kg" | "lb", string]>([
    ["weight × reps", "weight_reps", { weight: "185", reps: "5" }, "lb", "Log 185 × 5"],
    ["decimal weight, comma typed", "weight_reps", { weight: "102,5", reps: "5", weightUnit: "kg" }, "kg", "Log 102.5 × 5"],
    ["weight unit differs from the profile", "weight_reps", { weight: "82.5", reps: "5", weightUnit: "kg" }, "lb", "Log 82.5 kg × 5"],
    ["weighted bodyweight", "weighted_bodyweight", { weight: "25", reps: "8" }, "lb", "Log +25 × 8"],
    ["bodyweight reps", "bodyweight_reps", { reps: "12" }, "lb", "Log 12 reps"],
    ["one rep", "bodyweight_reps", { reps: "1" }, "lb", "Log 1 rep"],
    ["duration", "duration", { minutes: "1", seconds: "30" }, "lb", "Log 1:30"],
    ["distance and duration (distance unit always shown)", "distance_duration", { distance: "5", minutes: "25", seconds: "0" }, "kg", "Log 5 km · 25:00"],
    ["invalid draft", "weight_reps", { weight: "abc", reps: "5" }, "lb", "Log set"],
    ["empty draft", "weight_reps", {}, "lb", "Log set"],
  ])("%s", (_label, modality, values, pref, expected) => {
    expect(logLabel(modality, draft(values), pref)).toBe(expected);
  });
});
