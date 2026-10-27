import { HEVY_RPE_STEPS, type HevyRpe } from "./vocabulary.js";

/**
 * Spec 19.0 AC9: a SIN RPE onto Hevy's steps. Below 6 Hevy has no value (`null`); otherwise the nearest step, a
 * tie going to the higher one (7.25 → 7.5, 6.5 → 7). Import keeps Hevy's value as sent.
 */
export function roundRpeForHevy(rpe: number): HevyRpe | null {
  if (rpe < 6) return null;
  let best: HevyRpe = HEVY_RPE_STEPS[0];
  let bestDistance = Math.abs(rpe - best);
  for (const step of HEVY_RPE_STEPS) {
    const distance = Math.abs(rpe - step);
    if (distance < bestDistance || (distance === bestDistance && step > best)) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Spec 19.0 §6.3: the nearest 0.1, half away from zero. The scaled value is compared after `toFixed(6)`, so a
 * conversion that lands a hair under a tenth (20.411656 kg → 44.99999… lb) reads 45, not 44.9.
 */
export function roundToTenth(x: number): number {
  const scaled = Number((Math.abs(x) * 10).toFixed(6));
  const rounded = (Math.sign(x) * Math.round(scaled)) / 10;
  return rounded === 0 ? 0 : rounded;
}
