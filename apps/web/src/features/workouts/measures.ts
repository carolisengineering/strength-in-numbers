import { requiredMeasuresFor, type MeasureName, type Modality } from "@sin/core";

/**
 * Fixed display order, so every modality reads the same way. Spec 18.1 D9: weight comes before distance (a carry is
 * "24 kg · 40 m"); no legacy modality has both, so no legacy order changed.
 */
export const DISPLAY_ORDER: readonly MeasureName[] = ["weight", "distance", "reps", "durationS", "calories"];

export function visibleMeasures(modality: Modality): readonly MeasureName[] {
  const required = requiredMeasuresFor(modality);
  return DISPLAY_ORDER.filter((m) => required.includes(m));
}
