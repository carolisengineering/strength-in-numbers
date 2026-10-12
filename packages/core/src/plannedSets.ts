/**
 * Spec 09.1 §5 / §6.2 — pure planned-set rules shared by the API and the
 * editor (AC23), so server and client cannot disagree. No I/O.
 */
import { forbiddenMeasuresFor } from "./dto/set-entry.js";
import type { PlannedSet, PlannedSetInput } from "./dto/planned-set.js";
import type { Modality } from "./enums.js";

export const QUICK_LINE_KEYS = ["targetSets", "targetRepsLow", "targetRepsHigh"] as const;

export function normalizePlannedSet(r: PlannedSetInput): PlannedSet {
  return {
    setType: r.setType ?? "working",
    repsLow: r.repsLow ?? null,
    repsHigh: r.repsHigh ?? null,
    weight: r.weight ?? null,
    weightUnit: r.weightUnit ?? null,
  };
}

/** Legacy quick-line fields → rows (AC6). `targetSets` N → N identical working
 * rows with the rep range and no weight; no set count → no rows (O1). */
export function expandQuickLine(t: {
  targetSets?: number | null;
  targetRepsLow?: number | null;
  targetRepsHigh?: number | null;
}): PlannedSet[] {
  const n = t.targetSets ?? null;
  if (n === null || n < 1) return [];
  return Array.from({ length: n }, () => ({
    setType: "working" as const,
    repsLow: t.targetRepsLow ?? null,
    repsHigh: t.targetRepsHigh ?? null,
    weight: null,
    weightUnit: null,
  }));
}

/** The item's derived target columns (AC8): the count, and min low / max high
 * over the rows that have reps. */
export function deriveTargets(rows: readonly { repsLow?: number | null; repsHigh?: number | null }[]): {
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
} {
  if (rows.length === 0) return { targetSets: null, targetRepsLow: null, targetRepsHigh: null };
  const lows: number[] = [];
  const highs: number[] = [];
  for (const r of rows) {
    if (r.repsLow != null && r.repsHigh != null) {
      lows.push(r.repsLow);
      highs.push(r.repsHigh);
    }
  }
  return {
    targetSets: rows.length,
    targetRepsLow: lows.length > 0 ? Math.min(...lows) : null,
    targetRepsHigh: highs.length > 0 ? Math.max(...highs) : null,
  };
}

export interface PlannedSetViolation {
  row: number;
  field: "repsLow" | "repsHigh" | "weight" | "weightUnit";
  message: string;
}

const NOT_FOR_TYPE = "not allowed for this exercise type";

/** AC5 — measures a row carries that its exercise's modality cannot use. Derived
 * from Spec 05.1's measure table; a plan never carries distance or duration (D8). */
export function plannedSetViolations(modality: Modality, rows: readonly PlannedSetInput[]): PlannedSetViolation[] {
  const forbidden = forbiddenMeasuresFor(modality);
  const repsAllowed = !forbidden.includes("reps");
  const weightAllowed = !forbidden.includes("weight");
  const out: PlannedSetViolation[] = [];
  rows.forEach((r, row) => {
    if (!repsAllowed) {
      if (r.repsLow != null) out.push({ row, field: "repsLow", message: NOT_FOR_TYPE });
      if (r.repsHigh != null) out.push({ row, field: "repsHigh", message: NOT_FOR_TYPE });
    }
    if (!weightAllowed) {
      if (r.weight != null) out.push({ row, field: "weight", message: NOT_FOR_TYPE });
      if (r.weightUnit != null) out.push({ row, field: "weightUnit", message: NOT_FOR_TYPE });
    }
  });
  return out;
}

/** ≥1 row, all `working`, identical reps and weight + unit — Spec 10.2's
 * "Back to the quick line" is offered only then (nothing is silently lost). */
export function isUniformWorking(rows: readonly PlannedSet[]): boolean {
  const first = rows[0];
  if (first === undefined) return false;
  return rows.every(
    (r) =>
      r.setType === "working" &&
      r.repsLow === first.repsLow &&
      r.repsHigh === first.repsHigh &&
      r.weight === first.weight &&
      r.weightUnit === first.weightUnit,
  );
}
