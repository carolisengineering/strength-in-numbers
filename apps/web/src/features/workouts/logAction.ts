import type { Modality } from "@sin/core";

import { formatWeight } from "../routines/targetFormat";
import { formatDuration } from "./format";
import { parseDraft, type SetDraft } from "./setDraft";

/**
 * Spec 17.1 §6.6: the bar button's visible text. Mirrors `formatSet`'s core: the weight unit is appended only when it
 * differs from the profile's; a distance always carries its unit. "Log set" while the draft does not parse.
 */
export function logLabel(modality: Modality, draft: SetDraft, unitPreference: "kg" | "lb"): string {
  const parsed = parseDraft(modality, draft);
  if (!parsed.ok) return "Log set";
  const body = parsed.body;
  const unit = body.weightUnit !== undefined && body.weightUnit !== unitPreference ? ` ${body.weightUnit}` : "";
  const weight = body.weight === undefined ? "" : `${formatWeight(body.weight)}${unit}`;
  const reps = body.reps ?? 0;
  const duration = formatDuration(body.durationS ?? 0);
  switch (modality) {
    case "weight_reps":
      return `Log ${weight} × ${reps}`;
    case "weighted_bodyweight":
      return `Log +${weight} × ${reps}`;
    case "bodyweight_reps":
      return `Log ${reps} ${reps === 1 ? "rep" : "reps"}`;
    case "duration":
      return `Log ${duration}`;
    case "distance_duration":
      return `Log ${String(body.distance ?? 0)} ${body.distanceUnit ?? ""} · ${duration}`;
  }
}
