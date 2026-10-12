import { isUniformWorking, PLANNED_SETS_PER_ITEM_MAX, type PlannedSet, type SetType, type WeightUnit } from "@sin/core";
import type { DraftSet } from "./routineDraft";
import { formatReps, formatWeight, parseReps, parseWeight } from "./targetFormat";

/**
 * The item sheet's plan rows while it is open (Spec 10.2, P1): the typed text, not yet parsed. Pure — every
 * operation returns the SAME array when it changes nothing, so a caller can bail out of a re-render.
 */
export interface PlanRowText {
  readonly key: string;
  readonly setType: SetType;
  readonly reps: string;
  readonly weight: string;
  readonly weightUnit: WeightUnit | null;
}

export interface RowErrors {
  reps?: string;
  weight?: string;
}

export interface QuickText {
  readonly sets: string;
  readonly reps: string;
  readonly weight: string;
  readonly weightUnit: WeightUnit | null;
}

export function rowsFromPlan(plan: readonly DraftSet[]): PlanRowText[] {
  return plan.map((r) => ({
    key: r.key,
    setType: r.setType,
    reps: formatReps(r.repsLow, r.repsHigh),
    weight: r.weight === null ? "" : formatWeight(r.weight),
    weightUnit: r.weightUnit,
  }));
}

/** "Plan each set" from the quick line: `count` working rows (blank → one, D11) copying reps, weight and unit. */
export function enterPlan(
  quick: { count: number | null; reps: string; weight: string; weightUnit: WeightUnit | null },
  newKey: () => string,
): PlanRowText[] {
  const n = Math.min(Math.max(quick.count ?? 1, 1), PLANNED_SETS_PER_ITEM_MAX);
  return Array.from({ length: n }, () => ({
    key: newKey(),
    setType: "working" as const,
    reps: quick.reps,
    weight: quick.weight,
    weightUnit: quick.weightUnit,
  }));
}

export function addRow(rows: readonly PlanRowText[], key: string): readonly PlanRowText[] {
  if (rows.length >= PLANNED_SETS_PER_ITEM_MAX) return rows;
  const last = rows.at(-1);
  return [...rows, { key, setType: "working", reps: last?.reps ?? "", weight: last?.weight ?? "", weightUnit: last?.weightUnit ?? null }];
}

export function removeRow(rows: readonly PlanRowText[], rowKey: string): readonly PlanRowText[] {
  if (rows.length <= 1 || !rows.some((r) => r.key === rowKey)) return rows;
  return rows.filter((r) => r.key !== rowKey);
}

export function moveRow(rows: readonly PlanRowText[], rowKey: string, dir: -1 | 1): readonly PlanRowText[] {
  const from = rows.findIndex((r) => r.key === rowKey);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  next[from] = rows[to]!;
  next[to] = rows[from]!;
  return next;
}

export function setRowField(
  rows: readonly PlanRowText[],
  rowKey: string,
  patch: Partial<Pick<PlanRowText, "setType" | "reps" | "weight">>,
): readonly PlanRowText[] {
  const index = rows.findIndex((r) => r.key === rowKey);
  if (index < 0) return rows;
  const current = rows[index]!;
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => patch[k] !== undefined && patch[k] !== current[k]);
  if (!changed) return rows;
  return rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

/** D3: the one toggle relabels EVERY row's unit and never converts a number. */
export function setUnit(rows: readonly PlanRowText[], unit: WeightUnit): readonly PlanRowText[] {
  if (rows.every((r) => r.weightUnit === unit)) return rows;
  return rows.map((r) => ({ ...r, weightUnit: unit }));
}

/** The unit the rows that carry a weight agree on; `"mixed"` when they differ; `null` when none has a weight. */
export function unitOfRows(rows: readonly PlanRowText[]): WeightUnit | "mixed" | null {
  const units = new Set<WeightUnit>();
  for (const r of rows) if (r.weight.trim() !== "" && r.weightUnit !== null) units.add(r.weightUnit);
  if (units.size === 0) return null;
  return units.size === 1 ? [...units][0]! : "mixed";
}

export type ParsedRows =
  | { readonly ok: true; readonly rows: DraftSet[] }
  | { readonly ok: false; readonly errors: ReadonlyMap<string, RowErrors> };

/** Done in plan mode: every row through `parseReps` / `parseWeight`; errors by row key, in static wording. */
export function parseRows(rows: readonly PlanRowText[], fallbackUnit: WeightUnit): ParsedRows {
  const errors = new Map<string, RowErrors>();
  const out: DraftSet[] = [];
  for (const row of rows) {
    const reps = parseReps(row.reps);
    const weight = parseWeight(row.weight);
    if (!reps.ok || !weight.ok) {
      errors.set(row.key, { ...(reps.ok ? {} : { reps: reps.message }), ...(weight.ok ? {} : { weight: weight.message }) });
      continue;
    }
    out.push({
      key: row.key,
      setType: row.setType,
      repsLow: reps.value.low,
      repsHigh: reps.value.high,
      weight: weight.value,
      weightUnit: weight.value === null ? null : (row.weightUnit ?? fallbackUnit),
    });
  }
  return errors.size > 0 ? { ok: false, errors } : { ok: true, rows: out };
}

/** "Back to the quick line": only when `isUniformWorking` holds, so nothing is silently lost (D5). */
export function quickFromRows(rows: readonly PlanRowText[], fallbackUnit: WeightUnit): QuickText | null {
  const parsed = parseRows(rows, fallbackUnit);
  if (!parsed.ok) return null;
  const planned: PlannedSet[] = parsed.rows.map((r) => ({
    setType: r.setType,
    repsLow: r.repsLow,
    repsHigh: r.repsHigh,
    weight: r.weight,
    weightUnit: r.weightUnit,
  }));
  if (!isUniformWorking(planned)) return null;
  const first = parsed.rows[0]!;
  return {
    sets: String(parsed.rows.length),
    reps: formatReps(first.repsLow, first.repsHigh),
    weight: first.weight === null ? "" : formatWeight(first.weight),
    weightUnit: first.weightUnit,
  };
}
