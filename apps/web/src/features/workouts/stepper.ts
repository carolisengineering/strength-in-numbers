import { SET_REPS_MAX, SET_WEIGHT_MAX, type WeightUnit } from "@sin/core";

import { formatWeight } from "../routines/targetFormat";

/**
 * Spec 17.1 §6.4: a ± tap is a pure function from one draft string to another, dispatched through the same `edit`
 * action as a keystroke (AC21). Weight steps in integer milli-units so 187.5 + 2.5 is exactly 190; the step follows
 * the unit of the set being logged, never the profile (D5). Blank or unparsable text steps from 0.
 */
export type StepDirection = "down" | "up";

export const WEIGHT_STEP: Readonly<Record<WeightUnit, number>> = { lb: 5, kg: 2.5 };

const STEP_MILLI: Readonly<Record<WeightUnit, number>> = { lb: 5000, kg: 2500 };
const WEIGHT_MAX_MILLI = Math.round(SET_WEIGHT_MAX * 1000);

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/** `parseDecimal`'s grammar ("," allowed, up to 3 decimals) as integer milli-units; anything else is 0. */
function toMilli(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim().replace(",", "."));
  if (match === null) return 0;
  return Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
}

function toWhole(text: string): number {
  const s = text.trim();
  return /^\d+$/.test(s) ? Number(s) : 0;
}

export function stepWeight(text: string, unit: WeightUnit, direction: StepDirection): string {
  const sign = direction === "up" ? 1 : -1;
  return formatWeight(clamp(toMilli(text) + sign * STEP_MILLI[unit], 0, WEIGHT_MAX_MILLI) / 1000);
}

export function weightAtLimit(text: string, direction: StepDirection): boolean {
  const milli = toMilli(text);
  return direction === "up" ? milli >= WEIGHT_MAX_MILLI : milli <= 0;
}

export function stepReps(text: string, direction: StepDirection): string {
  return String(clamp(toWhole(text) + (direction === "up" ? 1 : -1), 0, SET_REPS_MAX));
}

export function repsAtLimit(text: string, direction: StepDirection): boolean {
  const reps = toWhole(text);
  return direction === "up" ? reps >= SET_REPS_MAX : reps <= 0;
}
