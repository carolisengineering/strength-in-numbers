import type { PersonalRecord } from "@sin/core";

/** Spec 07.5 AC39 (owner, 2026-11-08): the exercise page shows this many weights' rows until Show all. */
export const REPS_AT_WEIGHT_SHOWN = 5;

/**
 * Spec 07.5 AC39 (plan ruling R1): which of an exercise's records its page lists. `records` is already sorted
 * (`sortRecords`: type order, then the heavier weight first), and the order given is the order drawn. Every type but
 * most reps at a weight always shows (at most seven rows). Of the per-weight rows, collapsed shows the
 * `REPS_AT_WEIGHT_SHOWN` most recently achieved (an equal date: the heavier first), still drawn heaviest first;
 * expanded shows them all. `weights` is how many per-weight rows exist: the page offers Show all only above the cap.
 */
export function recordsToShow(records: readonly PersonalRecord[], expanded: boolean): { shown: PersonalRecord[]; weights: number } {
  const perWeight = records.filter((r) => r.recordType === "max_reps_at_weight");
  if (expanded || perWeight.length <= REPS_AT_WEIGHT_SHOWN) return { shown: [...records], weights: perWeight.length };
  const newest = new Set(
    [...perWeight]
      // By time, not text: an offset timestamp sorts wrong as a string (minor 686).
      .sort((a, b) => Date.parse(b.achievedAt) - Date.parse(a.achievedAt) || (b.atWeightKg ?? 0) - (a.atWeightKg ?? 0))
      .slice(0, REPS_AT_WEIGHT_SHOWN),
  );
  return { shown: records.filter((r) => r.recordType !== "max_reps_at_weight" || newest.has(r)), weights: perWeight.length };
}
