import type { Modality } from "@sin/core";

/** Display text for each modality (Spec 06.0 §5). */
export const MODALITY_LABELS: Record<Modality, string> = {
  weight_reps: "Weight × reps",
  bodyweight_reps: "Bodyweight × reps",
  weighted_bodyweight: "Weighted bodyweight",
  duration: "Duration",
  distance_duration: "Distance + duration",
  calories: "Calories",
  weight_distance: "Weight + distance",
  weight_duration: "Weight + duration",
};

/** One plain line with an example, shown under the type choices once one is picked (Spec 18.1 §6.1, D4). */
export const MODALITY_HINTS: Record<Modality, string> = {
  weight_reps: "Weight and reps, like a squat.",
  bodyweight_reps: "Reps only, like a pull-up.",
  weighted_bodyweight: "Added weight and reps, like a weighted dip.",
  duration: "Time only, like a plank.",
  distance_duration: "Distance and time, like a row or a run.",
  calories: "Calories only, like an Echo Bike.",
  weight_distance: "Weight and distance, like a farmer carry.",
  weight_duration: "Weight and time, like a weighted hold.",
};

/** Spec 17.13 AC13: why the create sheet's Save is off, naming only what's missing (code review #1). */
export const SAVE_OFF_INCOMPLETE = "Enter a name and choose a type.";
export const SAVE_OFF_NO_NAME = "Enter a name.";
export const SAVE_OFF_NO_TYPE = "Choose a type.";
