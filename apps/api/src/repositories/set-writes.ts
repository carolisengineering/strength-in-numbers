/**
 * Pure, DB-free set validation for the set write paths and the finish check
 * (Spec 05.1 §6.1, §6.5). Unit-testable with no database; shared by
 * `set-entry.prisma.ts` and `FakeWorkoutRepository`.
 *
 * These checks are handler-level, not Zod `superRefine`s: they need the
 * target's `modality_snapshot`, and on PATCH they must see the stored row
 * merged with the request (§6.1, D7).
 */
import {
  forbiddenMeasuresFor,
  requiredMeasuresFor,
  SET_DISTANCE_MAX,
  toCanonicalMeters,
  type DistanceUnit,
  type MeasureName,
  type Modality,
  type SetType,
  type WeightUnit,
} from "@sin/core";
import { ValidationError, type FieldError } from "../errors/app-error.js";
import type { CreateSetFields, SetEntryRecord, UpdateSetFields } from "./workout.js";

/** The fields §6.1's rules look at. */
export interface SetMeasures {
  setType: SetType;
  reps: number | null;
  weight: number | null;
  weightUnit: WeightUnit | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  durationS: number | null;
  isComplete: boolean;
}

/** Every writable column's next value — what an INSERT or UPDATE writes. */
export interface MergedSet extends SetMeasures {
  rpe: number | null;
}

/**
 * §6.1: throws `ValidationError` listing every violated field. Unit pairing
 * runs first and alone: a value with no unit is malformed whatever the
 * modality (AC20). Then forbidden measures (always), required measures (only
 * for a `working` set marked `isComplete` — D13: a `failure` set with zero
 * reps is a real record, D5), and the post-conversion distance bound (D11).
 */
export function assertSetMeasuresValid(modality: Modality, m: SetMeasures): void {
  const pairing: FieldError[] = [];
  if (m.weight !== null && m.weightUnit === null) pairing.push({ path: "weightUnit", message: "required when weight is set" });
  if (m.weightUnit !== null && m.weight === null) pairing.push({ path: "weight", message: "required when weightUnit is set" });
  if (m.distance !== null && m.distanceUnit === null) {
    pairing.push({ path: "distanceUnit", message: "required when distance is set" });
  }
  if (m.distanceUnit !== null && m.distance === null) {
    pairing.push({ path: "distance", message: "required when distanceUnit is set" });
  }
  if (pairing.length > 0) throw new ValidationError(pairing, "set: unit/value pairing");

  const errors: FieldError[] = [];
  for (const name of forbiddenMeasuresFor(modality)) {
    if (m[name] !== null) errors.push({ path: name, message: `not allowed for a ${modality} exercise` });
  }
  if (m.isComplete && m.setType === "working") {
    for (const name of requiredMeasuresFor(modality)) {
      if (m[name] === null) errors.push({ path: name, message: `required to complete a ${modality} set` });
    }
  }
  if (
    m.distance !== null &&
    m.distanceUnit !== null &&
    toCanonicalMeters(m.distance, m.distanceUnit) > SET_DISTANCE_MAX
  ) {
    errors.push({ path: "distance", message: `must not exceed ${SET_DISTANCE_MAX} metres` });
  }
  if (errors.length > 0) throw new ValidationError(errors, `set: ${modality} measure rules`);
}

/** §6.5: a `working` set passes the finish check iff every measure its
 * modality requires is present. */
export function isWorkingSetComplete(modality: Modality, m: Pick<SetMeasures, MeasureName>): boolean {
  return requiredMeasuresFor(modality).every((name) => m[name] !== null);
}

/** Create (§6.1 point 2): no stored row, so an absent key is null. */
export function fieldsToMeasures(fields: CreateSetFields): MergedSet {
  return {
    setType: fields.setType ?? "working",
    reps: fields.reps ?? null,
    weight: fields.weight ?? null,
    weightUnit: fields.weightUnit ?? null,
    distance: fields.distance ?? null,
    distanceUnit: fields.distanceUnit ?? null,
    durationS: fields.durationS ?? null,
    rpe: fields.rpe ?? null,
    isComplete: fields.isComplete ?? false,
  };
}

/** Patch (§6.1 point 3): an omitted key keeps the stored value; `null` clears
 * it — the same omission-vs-null rule 05.0's UpdateWorkoutSchema uses. */
export function mergeSetPatch(stored: SetEntryRecord, patch: UpdateSetFields): MergedSet {
  const keep = <T>(next: T | null | undefined, current: T | null): T | null => (next === undefined ? current : next);
  return {
    setType: patch.setType ?? (stored.setType as SetType),
    reps: keep(patch.reps, stored.reps),
    weight: keep(patch.weight, stored.weight),
    weightUnit: keep(patch.weightUnit, stored.weightUnit as WeightUnit | null),
    distance: keep(patch.distance, stored.distance),
    distanceUnit: keep(patch.distanceUnit, stored.distanceUnit as DistanceUnit | null),
    durationS: keep(patch.durationS, stored.durationS),
    rpe: keep(patch.rpe, stored.rpe),
    isComplete: patch.isComplete ?? stored.isComplete,
  };
}
