import type { Modality } from "../enums.js";
import { modalitiesCompatible } from "../modality-change.js";
import type { HevyType, MeasureRule } from "./vocabulary.js";

/**
 * Spec 19.0 AC4: the SIN modality a Hevy type reads as. `null` for an assisted exercise: its weight is the assist,
 * so it pairs only with `bodyweight_reps` under `assist_weight_ignored`.
 */
const CANONICAL: Readonly<Record<HevyType, Modality | null>> = Object.freeze({
  weight_reps: "weight_reps",
  reps_only: "bodyweight_reps",
  bodyweight_reps: "weighted_bodyweight",
  bodyweight_assisted_reps: null,
  duration: "duration",
  weight_duration: "weight_duration",
  distance_duration: "distance_duration",
  short_distance_weight: "weight_distance",
});

export function canonicalModalityForHevyType(hevyType: HevyType): Modality | null {
  return CANONICAL[hevyType];
}

/** Why a Hevy type and a SIN modality cannot pair under a rule. */
export type PairingProblem = "type_mismatch" | "rule_not_allowed" | "rule_required";

/**
 * Spec 19.0 §6.2: `null` when the pair is allowed, else the problem. A rule is allowed only on its one pairing;
 * without a rule the canonical modality must be `modalitiesCompatible` with the SIN one. Hevy `reps_only` and SIN
 * `calories` need `calories_as_reps` (read as reps, every set would be refused).
 */
export function hevyPairingProblem(hevyType: HevyType, modality: Modality, rule: MeasureRule | null): PairingProblem | null {
  if (rule === "calories_as_reps") return hevyType === "reps_only" && modality === "calories" ? null : "rule_not_allowed";
  if (rule === "assist_weight_ignored") {
    return hevyType === "bodyweight_assisted_reps" && modality === "bodyweight_reps" ? null : "rule_not_allowed";
  }
  if (hevyType === "reps_only" && modality === "calories") return "rule_required";
  const canonical = canonicalModalityForHevyType(hevyType);
  if (canonical === null) return "type_mismatch";
  return modalitiesCompatible(canonical, modality) ? null : "type_mismatch";
}

/** Spec 19.0 AC5: the rule to propose (never to apply silently) for a Hevy "(calories)" exercise. */
export function defaultMeasureRule(title: string, hevyType: HevyType): MeasureRule | null {
  return hevyType === "reps_only" && title.toLowerCase().includes("(calories)") ? "calories_as_reps" : null;
}

const HEVY_TYPE_FOR: Readonly<Record<Modality, HevyType>> = Object.freeze({
  weight_reps: "weight_reps",
  bodyweight_reps: "reps_only",
  weighted_bodyweight: "bodyweight_reps",
  duration: "duration",
  distance_duration: "distance_duration",
  weight_duration: "weight_duration",
  weight_distance: "short_distance_weight",
  calories: "reps_only",
});

/** Spec 19.0 AC15: the Hevy type to prefill when creating a Hevy exercise for a SIN one. */
export function hevyTypeForModality(modality: Modality): HevyType {
  return HEVY_TYPE_FOR[modality];
}
