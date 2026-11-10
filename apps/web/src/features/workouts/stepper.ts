import { SET_CALORIES_MAX, SET_DISTANCE_MAX, SET_DURATION_S_MAX, SET_REPS_MAX, SET_WEIGHT_MAX, toCanonicalMeters, type DistanceUnit, type WeightUnit } from "@sin/core";

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

/** Spec 18.1 D7: bike and ski sessions are logged in tens of calories, so one tap is 5; typing covers anything else. */
export const CALORIES_STEP = 5;

/** ± 5 from where the value is (22 → 27, no snapping), clamped to 0 … SET_CALORIES_MAX. */
export function stepCalories(text: string, direction: StepDirection): string {
  return String(clamp(toWhole(text) + (direction === "up" ? CALORIES_STEP : -CALORIES_STEP), 0, SET_CALORIES_MAX));
}

export function caloriesAtLimit(text: string, direction: StepDirection): boolean {
  const calories = toWhole(text);
  return direction === "up" ? calories >= SET_CALORIES_MAX : calories <= 0;
}

/**
 * Spec 17.8 AC11 (D5, O2): a duration steps its total by 5 s and rewrites both fields, so 0:59 + 5 s reads 1:04 and
 * seconds never pass 59. A field that doesn't parse counts as 0. The output is unpadded, like `draftFromSet`.
 */
export const DURATION_STEP_S = 5;

const durationTotal = (minutes: string, seconds: string): number => toWhole(minutes) * 60 + toWhole(seconds);

export function stepDuration(minutes: string, seconds: string, direction: StepDirection): { minutes: string; seconds: string } {
  const total = clamp(durationTotal(minutes, seconds) + (direction === "up" ? DURATION_STEP_S : -DURATION_STEP_S), 0, SET_DURATION_S_MAX);
  return { minutes: String(Math.floor(total / 60)), seconds: String(total % 60) };
}

export function durationAtLimit(minutes: string, seconds: string, direction: StepDirection): boolean {
  const total = durationTotal(minutes, seconds);
  return direction === "up" ? total >= SET_DURATION_S_MAX : total <= 0;
}

/** Spec 17.8 AC12 (O2): 10 for m and ft, 0.1 for km and mi, in the draft's distance unit. */
export const DISTANCE_STEP: Readonly<Record<DistanceUnit, number>> = { m: 10, ft: 10, km: 0.1, mi: 0.1 };
const DISTANCE_STEP_MILLI: Readonly<Record<DistanceUnit, number>> = { m: 10_000, ft: 10_000, km: 100, mi: 100 };

/**
 * The largest distance, in milli-units of `unit`, that `parseDraft` accepts: the entered value is bounded by
 * SET_DISTANCE_MAX, and so are its meters (Review Focus 1: in ft the entered-value bound is the one that bites).
 */
function distanceLimitMilli(unit: DistanceUnit): number {
  const fits = (milli: number) => milli / 1000 <= SET_DISTANCE_MAX && toCanonicalMeters(milli / 1000, unit) <= SET_DISTANCE_MAX;
  let milli = Math.min(Math.round(SET_DISTANCE_MAX * 1000), Math.floor((SET_DISTANCE_MAX * 1000) / toCanonicalMeters(1, unit)));
  while (milli > 0 && !fits(milli)) milli -= 1;
  return milli;
}

/** Integer milli-units, as weight steps, so 0.1 + 0.2 is exactly 0.3; a step never leaves text `parseDraft` refuses. */
export function stepDistance(text: string, unit: DistanceUnit, direction: StepDirection): string {
  const milli = toMilli(text);
  const limit = distanceLimitMilli(unit);
  if (direction === "up") return milli + DISTANCE_STEP_MILLI[unit] > limit ? text : formatWeight((milli + DISTANCE_STEP_MILLI[unit]) / 1000);
  return formatWeight(clamp(milli - DISTANCE_STEP_MILLI[unit], 0, limit) / 1000);
}

export function distanceAtLimit(text: string, unit: DistanceUnit, direction: StepDirection): boolean {
  const milli = toMilli(text);
  return direction === "up" ? milli + DISTANCE_STEP_MILLI[unit] > distanceLimitMilli(unit) : milli <= 0;
}

/** Spec 17.8 AC3: the true minus sign (U+2212), never an ASCII hyphen, in every visible step and name. */
export const MINUS = "−";

/** A step button's visible text: "−5", "+2.5". `step` may carry a unit ("5 lb") for a name. */
export function stepText(direction: StepDirection, step: number | string): string {
  return `${direction === "up" ? "+" : MINUS}${step}`;
}

/**
 * Spec 17.8 AC4: the accessible name starts with the visible text (WCAG 2.5.3) and names the exercise (17.1 AC38):
 * "−5 lb, decrease weight for Overhead Press".
 */
export function stepName(direction: StepDirection, step: number | string, noun: string, exerciseName: string): string {
  return `${stepText(direction, step)}, ${direction === "up" ? "increase" : "decrease"} ${noun} for ${exerciseName}`;
}
