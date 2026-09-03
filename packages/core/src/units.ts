/**
 * Unit conversion. Canonical units are **kilograms** and **metres**.
 *
 * These functions define the constants that DESIGN §4.8 requires the Spec 05
 * `set_entry.weight_kg` / `set_entry.distance_m` generated columns to reuse
 * verbatim — drift silently corrupts every PR, chart, and aggregate (Risk R4).
 *
 * No rounding, clamping, or formatting happens here. Stored values keep full
 * precision (DESIGN §4.8); display precision belongs to whichever spec renders
 * the number (04/06/08), not to `@sin/core`.
 */
import type { DistanceUnit, WeightUnit } from "./enums.js";

/** Pounds → kilograms (exact, international avoirdupois pound). */
export const LB_TO_KG = 0.45359237;
/** Kilometres → metres. */
export const KM_TO_M = 1000;
/** Miles → metres (exact: 1 mi = 1609.344 m). */
export const MI_TO_M = 1609.344;

/** A weight in its entered unit → kilograms (canonical). */
export function toCanonicalKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * LB_TO_KG;
}

/** A distance in its entered unit → metres (canonical). */
export function toCanonicalMeters(value: number, unit: DistanceUnit): number {
  switch (unit) {
    case "m":
      return value;
    case "km":
      return value * KM_TO_M;
    case "mi":
      return value * MI_TO_M;
  }
}

export function kgToLb(kg: number): number {
  return kg / LB_TO_KG;
}

export function lbToKg(lb: number): number {
  return lb * LB_TO_KG;
}

export function kmToM(km: number): number {
  return km * KM_TO_M;
}

export function mToKm(m: number): number {
  return m / KM_TO_M;
}

export function miToM(mi: number): number {
  return mi * MI_TO_M;
}

export function mToMi(m: number): number {
  return m / MI_TO_M;
}
