import type { Modality, PlannedSet, SetType } from "@sin/core";
import { formatWeight } from "../routines/targetFormat";
import { SET_TYPE_LABELS } from "./format";
import { visibleMeasures } from "./measures";

/**
 * Spec 10.2 AC20, D2: progress through a plan is POSITIONAL — the n-th set on the card consumes the n-th row,
 * whatever its type or values. `loggedCount` is the number of sets in the list the card renders (queued and
 * failed rows included, 06.2); never a `setNumber`, which is append-only and not dense (DESIGN §4.4).
 */
export type NextPlanned =
  | { readonly kind: "planned"; readonly row: PlannedSet; readonly index: number; readonly total: number }
  | { readonly kind: "extra" }
  | { readonly kind: "none" };

export function nextPlanned(plannedSets: readonly PlannedSet[], loggedCount: number): NextPlanned {
  const total = plannedSets.length;
  if (total === 0) return { kind: "none" };
  const row = plannedSets[loggedCount];
  return row === undefined ? { kind: "extra" } : { kind: "planned", row, index: loggedCount, total };
}

/** "Set 3 of 4", "Set 1 of 5 · Warm-up", "Extra set"; with no plan exactly today's "Set {n + 1}" (AC21, AC27). */
export function setLabel(plannedSets: readonly PlannedSet[], loggedCount: number, setType: SetType): string {
  const next = nextPlanned(plannedSets, loggedCount);
  const head = next.kind === "none" ? `Set ${loggedCount + 1}` : next.kind === "extra" ? "Extra set" : `Set ${next.index + 1} of ${next.total}`;
  // Spec 17.7 AC17: the suffix follows the draft's type, so a set that isn't working is never invisible.
  return setType === "working" ? head : `${head} · ${SET_TYPE_LABELS[setType]}`;
}

/**
 * Spec 17.8 AC6: the next planned row's target, "6–8", "5", "6–8 @ 30 kg" or "30 kg"; null when the row has neither.
 * It reads only the measures the exercise's type can show: a stale row (a Plank still holding 8 × 60 kg, Spec 03.4
 * D22) must not advertise a target the panel can't log. The range uses an en dash, as `targetLine` does, and needs
 * both ends.
 */
export function setTarget(row: PlannedSet, modality: Modality): string | null {
  const measures = visibleMeasures(modality);
  const reps = measures.includes("reps") && row.repsLow !== null && row.repsHigh !== null ? (row.repsLow === row.repsHigh ? `${row.repsLow}` : `${row.repsLow}–${row.repsHigh}`) : null;
  const weight = measures.includes("weight") && row.weight !== null && row.weightUnit !== null ? `${formatWeight(row.weight)} ${row.weightUnit}` : null;
  if (reps !== null && weight !== null) return `${reps} @ ${weight}`;
  return reps ?? weight;
}
