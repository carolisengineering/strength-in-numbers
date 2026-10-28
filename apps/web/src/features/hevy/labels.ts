import type { HevySectionRule, HevyType, MeasureRule } from "@sin/core";

/** Spec 20.0: how a Hevy exercise type reads on screen (plan copy; 20.2 reuses it). */
export const HEVY_TYPE_LABELS: Readonly<Record<HevyType, string>> = Object.freeze({
  weight_reps: "Weight & reps",
  reps_only: "Reps only",
  bodyweight_reps: "Weighted bodyweight",
  bodyweight_assisted_reps: "Assisted bodyweight",
  duration: "Duration",
  weight_duration: "Weight & duration",
  distance_duration: "Distance & duration",
  short_distance_weight: "Weight & distance",
});

/** AC24: a pairing's measure rule, as a badge. */
export const RULE_BADGES: Readonly<Record<MeasureRule, string>> = Object.freeze({
  calories_as_reps: "calories as reps",
  assist_weight_ignored: "ignores assist weight",
});

/** Minor 186: how a section rule's treatment reads in the load preview. */
export const TREATMENT_LABELS: Readonly<Record<HevySectionRule["treatment"], string>> = Object.freeze({
  warmup_placeholder: "Warmup marker",
  workout_placeholder: "Workout marker",
  notes_on_first: "Notes on the first exercise",
});
