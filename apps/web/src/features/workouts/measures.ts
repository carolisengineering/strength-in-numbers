import { requiredMeasuresFor, type MeasureName, type Modality } from "@sin/core";

/** Fixed display order, so every modality reads the same way (distance, weight, reps, duration). */
export const DISPLAY_ORDER: readonly MeasureName[] = ["distance", "weight", "reps", "durationS"];

export function visibleMeasures(modality: Modality): readonly MeasureName[] {
  const required = requiredMeasuresFor(modality);
  return DISPLAY_ORDER.filter((m) => required.includes(m));
}
