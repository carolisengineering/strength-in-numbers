import type { SetType, WeightUnit } from "@sin/core";
import type { PlanRowText } from "./planRows";
import { parseReps, parseWeight } from "./targetFormat";

/** The 05.1 wording and order. Local on purpose: `routines/` must not import `workouts/`. */
export const SET_TYPE_CHOICES: readonly { value: SetType; label: string }[] = [
  { value: "warmup", label: "Warm-up" },
  { value: "working", label: "Working" },
  { value: "drop", label: "Drop" },
  { value: "failure", label: "Failure" },
];

/** Spec 17.11 AC16: a collapsed row with an error says so in words, not by color alone. */
export const CHECK_THIS_SET = "Check this set";

const EMPTY = "–";

export interface PlanRowSummaryOptions {
  /** The set's 1-based place in the plan. */
  readonly n: number;
  readonly showReps: boolean;
  readonly showWeight: boolean;
  /** The sheet's unit; while it is "mixed", each row shows its own. */
  readonly unit: WeightUnit | "mixed";
}

/**
 * A planned set's one-line summary (Spec 17.11 §6.3, AC11): "1 · Warm-up · 8 reps · 40 kg". The parts follow the
 * exercise's type as the fields do; a blank field is "–". Text is shown as the lifter typed it (trimmed): the parsers
 * only decide whether "reps" or the unit follows, so "abc" or "4o" reads as typed, never reformatted.
 */
export function planRowSummary(row: PlanRowText, { n, showReps, showWeight, unit }: PlanRowSummaryOptions): string {
  const type = SET_TYPE_CHOICES.find((c) => c.value === row.setType)?.label ?? row.setType;
  const parts = [String(n), type];
  if (showReps) {
    const reps = row.reps.trim();
    const parsed = parseReps(reps);
    // A heavy single reads "1 rep"; a range ending above one ("1-3") stays plural.
    const word = parsed.ok && parsed.value.high === 1 ? "rep" : "reps";
    parts.push(reps === "" ? EMPTY : parsed.ok ? `${reps} ${word}` : reps);
  }
  if (showWeight) {
    const weight = row.weight.trim();
    const shownUnit = unit === "mixed" ? row.weightUnit : unit;
    parts.push(weight === "" ? EMPTY : parseWeight(weight).ok && shownUnit !== null ? `${weight} ${shownUnit}` : weight);
  }
  return parts.join(" · ");
}
