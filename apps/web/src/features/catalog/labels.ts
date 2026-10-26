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
