import { formatClock, type Modality, type SetEntry, type SetType } from "@sin/core";

// One pinned formatter so tests and CI are locale-independent (06.0 AC6's reasoning).
const NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

// Spec 17.13 AC1: dates and times live in `ui/dateText.ts`; these names stay here for their callers.
export { formatLocalDate, formatStartedAt, formatStartedTime } from "../../ui/dateText";

/** Labels for the Set-type select and the tag on a logged row. */
export const SET_TYPE_LABELS: Record<SetType, string> = {
  working: "Working",
  warmup: "Warm-up",
  drop: "Drop",
  failure: "Failure",
};

/** A count grouped like every other figure ("1,200"); Spec 18.1 §6.5 uses it for calories. */
export const formatCount = (n: number): string => NUMBER.format(n);

const orDash = (value: number | null, render: (n: number) => string): string =>
  value === null ? "–" : render(value);

const withUnit = (value: number | null, unit: string | null): string =>
  orDash(value, (n) => `${NUMBER.format(n)} ${unit ?? ""}`.trim());

/** A logged set's core text and its non-working type suffix (" (Warm-up)"); Spec 17.1 AC39 hides the warm-up one visually. */
export function formatSetParts(set: SetEntry, modality: Modality): { core: string; typeSuffix: string } {
  const reps = orDash(set.reps, String);
  let core: string;
  switch (modality) {
    case "weight_reps":
      core = `${withUnit(set.weight, set.weightUnit)} × ${reps}`;
      break;
    case "bodyweight_reps":
      core = set.reps === null ? "–" : `${set.reps} reps`;
      break;
    case "weighted_bodyweight":
      core = `${set.weight === null ? "–" : `+${withUnit(set.weight, set.weightUnit)}`} × ${reps}`;
      break;
    case "duration":
      core = orDash(set.durationS, formatClock);
      break;
    case "distance_duration":
      core = `${withUnit(set.distance, set.distanceUnit)} · ${orDash(set.durationS, formatClock)}`;
      break;
    // Spec 18.1 §6.5: "·" between the measures, never "×" — a carry is not weight times distance (D8).
    case "calories":
      core = orDash(set.calories, (n) => `${formatCount(n)} cal`);
      break;
    case "weight_distance":
      core = `${withUnit(set.weight, set.weightUnit)} · ${withUnit(set.distance, set.distanceUnit)}`;
      break;
    case "weight_duration":
      core = `${withUnit(set.weight, set.weightUnit)} · ${orDash(set.durationS, formatClock)}`;
      break;
  }
  // Spec 17.1 Phase A: RPE is stored but never shown.
  return { core, typeSuffix: set.setType === "working" ? "" : ` (${SET_TYPE_LABELS[set.setType]})` };
}

export function formatSet(set: SetEntry, modality: Modality): string {
  const { core, typeSuffix } = formatSetParts(set, modality);
  return `${core}${typeSuffix}`;
}
