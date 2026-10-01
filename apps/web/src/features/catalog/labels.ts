import type { Modality } from "@sin/core";

/** Display text for each modality (Spec 06.0 §5). */
export const MODALITY_LABELS: Record<Modality, string> = {
  weight_reps: "Weight × reps",
  bodyweight_reps: "Bodyweight × reps",
  weighted_bodyweight: "Weighted bodyweight",
  duration: "Duration",
  distance_duration: "Distance + duration",
};
