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

/** The types the create form offers. Spec 05.3 D15 keeps the three new ones out until the UI spec (18.1) adds them. */
export const CREATABLE_MODALITIES: readonly Modality[] = Object.freeze([
  "weight_reps",
  "bodyweight_reps",
  "weighted_bodyweight",
  "duration",
  "distance_duration",
]);
