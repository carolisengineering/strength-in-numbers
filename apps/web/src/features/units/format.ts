import type { RecordUnit, UnitPreference } from "@sin/core";

/**
 * Canonical kg → the lifter's unit (Spec 08.0 §6.4, D8). Pure and React-free so Spec 08.1's chart
 * axes reuse it (and it can move to `@sin/core` later).
 *
 * kg is shown as stored (`numeric(…,3)`): rounding 101.25 kg to 101.3 would break a hand check.
 * lb is rounded to 1 decimal: the conversion is irrational, so more digits are noise — and 225 lb
 * stored as 102.058 kg comes back as 224.9998…, which rounds to 225. `Intl` drops trailing zeros.
 */
const KG_PER_LB = 0.45359237; // the exact definition of the pound (DESIGN §4.8)
const KG = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
const LB = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const COUNT = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function inUnit(kg: number, pref: UnitPreference): string {
  return pref === "lb" ? `${LB.format(kg / KG_PER_LB)} lb` : `${KG.format(kg)} kg`;
}

export function formatWeightKg(kg: number, pref: UnitPreference): string {
  return inUnit(kg, pref);
}

/** Volume is kg × reps; reps are dimensionless, so converting the kg factor converts the sum. */
export function formatVolumeKg(kgReps: number, pref: UnitPreference): string {
  return inUnit(kgReps, pref);
}

export function formatRecordValue(value: number, unit: RecordUnit, pref: UnitPreference): string {
  switch (unit) {
    case "kg":
      return formatWeightKg(value, pref);
    case "kg_reps":
      return formatVolumeKg(value, pref);
    case "reps":
      return value === 1 ? "1 rep" : `${COUNT.format(value)} reps`;
    default: {
      const unreachable: never = unit;
      throw new Error(`Unhandled record unit: ${String(unreachable)}`);
    }
  }
}
