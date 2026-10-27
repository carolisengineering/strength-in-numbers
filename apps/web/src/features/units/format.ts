import { kgToLb, type RecordType, type RecordUnit, type UnitPreference } from "@sin/core";

/**
 * Canonical kg → the lifter's unit (Spec 08.0 §6.4, D8). Pure and React-free so Spec 08.1's chart
 * axes reuse it (and it can move to `@sin/core` later).
 *
 * kg is shown as stored (`numeric(…,3)`): rounding 101.25 kg to 101.3 would break a hand check.
 * lb is rounded to 1 decimal: the conversion is irrational, so more digits are noise — and 225 lb
 * stored as 102.058 kg comes back as 224.9998…, which rounds to 225. `Intl` drops trailing zeros.
 */
// The conversion itself is `@sin/core`'s `kgToLb` — one copy of the pound's definition (DESIGN §4.8, R4).
const KG =new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
const LB = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const COUNT = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
/** Up to 3 decimals: the stored millimeter, never float noise from a subtraction ("+0.002 m"). */
const DISTANCE = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

/**
 * Spec 18.1 O3: seconds in words, zero parts omitted — "45 s", "1 min 30 s", "2 min", "1 h 2 min 5 s"; 0 is "0 s".
 * A fractional input is rounded and a negative one reads "0 s"; neither occurs today (stored seconds are whole, gains positive).
 */
export function formatSeconds(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h > 0 ? `${COUNT.format(h)} h` : null, min > 0 ? `${min} min` : null, s > 0 ? `${s} s` : null].filter((p): p is string => p !== null);
  return parts.length === 0 ? "0 s" : parts.join(" ");
}

function inUnit(kg: number, pref: UnitPreference): string {
  return pref === "lb" ? `${LB.format(kgToLb(kg))} lb` : `${KG.format(kg)} kg`;
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
    case "cal":
      return `${COUNT.format(value)} cal`;
    // Spec 18.1 D6: a record distance is meters for every account, even when typed in feet (05.3 D19).
    case "m":
      return `${DISTANCE.format(value)} m`;
    case "s":
      return formatSeconds(value);
    default: {
      const unreachable: never = unit;
      throw new Error(`Unhandled record unit: ${String(unreachable)}`);
    }
  }
}

/**
 * Spec 17.2 §6.4 (AC21-AC23, AC29): an estimated 1RM is an estimate, so it is shown on a coarse step: the nearest 1 lb for
 * lb accounts, 0.5 kg for kg accounts. Display only (nothing in `@sin/core` changes, and chart data is not rounded).
 * Arithmetic is on the integer step count, so a gain is a difference of whole steps, never float subtraction noise.
 */
const E1RM_SHOWN = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

const e1rmStep = (pref: UnitPreference): number => (pref === "lb" ? 1 : 0.5);

/** The display-unit value divided by its step, rounded half up. */
export function e1rmSteps(valueKg: number, pref: UnitPreference): number {
  const display = pref === "lb" ? kgToLb(valueKg) : valueKg;
  return Math.round(display / e1rmStep(pref));
}

const stepsText = (steps: number, pref: UnitPreference): string => `${E1RM_SHOWN.format(steps * e1rmStep(pref))} ${pref}`;

export function roundedE1rm(valueKg: number, pref: UnitPreference): string {
  return stepsText(e1rmSteps(valueKg, pref), pref);
}

/** "+5 lb" / "+0.5 kg": the difference of the rounded values; `null` when it is not a rise (D16: no "+0"). */
export function formatE1rmGain(newKg: number, prevKg: number, pref: UnitPreference): string | null {
  const gain = e1rmSteps(newKg, pref) - e1rmSteps(prevKg, pref);
  return gain > 0 ? `+${stepsText(gain, pref)}` : null;
}

/** `formatRecordValue`, except an est. 1RM goes through `roundedE1rm`: the one door for record values by type. */
export function formatRecordByType(recordType: RecordType, value: number, unit: RecordUnit, pref: UnitPreference): string {
  return recordType === "best_est_1rm" ? roundedE1rm(value, pref) : formatRecordValue(value, unit, pref);
}
