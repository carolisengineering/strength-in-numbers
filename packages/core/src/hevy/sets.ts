import {
  forbiddenMeasuresFor,
  requiredMeasuresFor,
  SET_CALORIES_MAX,
  SET_DISTANCE_MAX,
  SET_DURATION_S_MAX,
  SET_REPS_MAX,
  SET_WEIGHT_MAX,
  type MeasureName,
  type SetEntry,
} from "../dto/set-entry.js";
import type { HevyPostSet, HevySet } from "../dto/hevy-api.js";
import type { Modality, SetType, UnitPreference } from "../enums.js";
import { kgToLb } from "../units.js";
import { roundRpeForHevy, roundToTenth } from "./rpe.js";
import type { HevySetType, HevyType, MeasureRule } from "./vocabulary.js";

/** Spec 19.0 AC6: Hevy set types → SIN. */
export const HEVY_TO_SIN_SET_TYPE: Readonly<Record<HevySetType, SetType>> = Object.freeze({
  warmup: "warmup",
  normal: "working",
  dropset: "drop",
  failure: "failure",
});

/** Spec 19.0 AC8: SIN set types → Hevy, one to one. */
export const SIN_TO_HEVY_SET_TYPE: Readonly<Record<SetType, HevySetType>> = Object.freeze({
  warmup: "warmup",
  working: "normal",
  drop: "dropset",
  failure: "failure",
});

/** What an import needs to know about the pair a set is read through. */
export interface HevyImportCtx {
  hevyType: HevyType;
  modality: Modality;
  rule: MeasureRule | null;
  unit: UnitPreference;
}

/** A Hevy set whose type the caller has checked is one of Hevy's four (an odd type marks the workout, Spec 20.1 D9). */
export type HevyImportSet = Omit<HevySet, "type"> & { type: HevySetType };

/** A set ready for SIN's set writes. Weight in the user's unit, distance in meters; always complete. */
export interface ImportedSet {
  setType: SetType;
  reps: number | null;
  weight: number | null;
  weightUnit: UnitPreference | null;
  distance: number | null;
  distanceUnit: "m" | null;
  durationS: number | null;
  calories: number | null;
  rpe: number | null;
  isComplete: true;
}

/** Values the import read and set aside, counted for the summary. */
export type SetIgnored = "custom_metric" | "assist_weight" | "zero_forbidden";

/** Why a Hevy set was not imported. */
export const SET_DROP_REASONS = Object.freeze(["missing_measure", "forbidden_measure", "out_of_range"] as const);
export type SetDropReason = (typeof SET_DROP_REASONS)[number];

export type HevySetImport = { ok: true; set: ImportedSet; ignored: SetIgnored[] } | { ok: false; reason: SetDropReason };

const MAX: Readonly<Record<MeasureName, number>> = Object.freeze({
  reps: SET_REPS_MAX,
  weight: SET_WEIGHT_MAX,
  distance: SET_DISTANCE_MAX,
  durationS: SET_DURATION_S_MAX,
  calories: SET_CALORIES_MAX,
});
const WHOLE: ReadonlySet<MeasureName> = new Set<MeasureName>(["reps", "calories", "durationS"]);

/**
 * Spec 19.0 AC6–AC7, §6.3: one Hevy set into SIN, in order: set type, the measure rule, forbidden measures (null or
 * 0 ignored, anything else refused), weight into the user's unit (nearest 0.1), bounds, required measures. An
 * incomplete set is dropped, never stored half-filled (D9).
 */
export function hevySetToSin(set: HevyImportSet, ctx: HevyImportCtx): HevySetImport {
  const ignored: SetIgnored[] = [];
  const values: Record<MeasureName, number | null> = {
    reps: set.reps ?? null,
    weight: set.weight_kg ?? null,
    distance: set.distance_meters ?? null,
    durationS: set.duration_seconds ?? null,
    calories: null,
  };
  if (set.custom_metric != null) ignored.push("custom_metric");

  if (ctx.rule === "calories_as_reps") {
    values.calories = values.reps;
    values.reps = null;
  } else if (ctx.rule === "assist_weight_ignored") {
    if (values.weight !== null && values.weight !== 0) ignored.push("assist_weight");
    values.weight = null;
  }

  for (const measure of forbiddenMeasuresFor(ctx.modality)) {
    const value = values[measure];
    if (value === null) continue;
    if (value !== 0) return { ok: false, reason: "forbidden_measure" };
    ignored.push("zero_forbidden");
    values[measure] = null;
  }

  if (values.weight !== null) values.weight = roundToTenth(ctx.unit === "lb" ? kgToLb(values.weight) : values.weight);

  for (const measure of Object.keys(values) as MeasureName[]) {
    const value = values[measure];
    if (value === null) continue;
    if (value < 0 || value > MAX[measure] || (WHOLE.has(measure) && !Number.isInteger(value))) return { ok: false, reason: "out_of_range" };
  }

  if (requiredMeasuresFor(ctx.modality).some((measure) => values[measure] === null)) return { ok: false, reason: "missing_measure" };

  return {
    ok: true,
    ignored: [...new Set(ignored)],
    set: {
      setType: HEVY_TO_SIN_SET_TYPE[set.type],
      reps: values.reps,
      weight: values.weight,
      weightUnit: values.weight === null ? null : ctx.unit,
      distance: values.distance,
      distanceUnit: values.distance === null ? null : "m",
      durationS: values.durationS,
      calories: values.calories,
      rpe: set.rpe ?? null,
      isComplete: true,
    },
  };
}

/** The export's notices (Spec 19.0 AC11, D28): data, never prose. */
export const HEVY_EXPORT_NOTICES = Object.freeze([
  "rpe_dropped",
  "rpe_rounded",
  "distance_rounded",
  "sets_not_sent",
  "section_no_placeholder",
  "title_fallback",
] as const);
export type ExportNoticeCode = (typeof HEVY_EXPORT_NOTICES)[number];
/** `count` is the sets (or sections) affected; `names` only on `section_no_placeholder`. */
export interface ExportNotice {
  code: ExportNoticeCode;
  count: number;
  names?: string[];
}

/** The pair a SIN set is sent through. */
export interface HevyExportCtx {
  modality: Modality;
  hevyType: HevyType;
  rule: MeasureRule | null;
}

type HevyField = "weight_kg" | "reps" | "distance_meters" | "duration_seconds";
const FIELDS: Readonly<Record<HevyType, readonly HevyField[]>> = Object.freeze({
  weight_reps: ["weight_kg", "reps"],
  reps_only: ["reps"],
  bodyweight_reps: ["weight_kg", "reps"],
  bodyweight_assisted_reps: ["reps"],
  duration: ["duration_seconds"],
  weight_duration: ["weight_kg", "duration_seconds"],
  distance_duration: ["distance_meters", "duration_seconds"],
  short_distance_weight: ["weight_kg", "distance_meters"],
});

const MEASURE_OF: Readonly<Record<MeasureName, (s: SetEntry) => number | null>> = Object.freeze({
  reps: (s) => s.reps,
  weight: (s) => s.weightKg,
  distance: (s) => s.distanceM,
  durationS: (s) => s.durationS,
  calories: (s) => s.calories,
});

/**
 * Spec 19.0 AC8–AC9, §6.3: one SIN set into Hevy, from the stored canonical values (`weightKg`, `distanceM`), so a
 * lb or ft set sends what the records engine sees. Only the fields the Hevy type holds are written, plus `type` and
 * `rpe`; `custom_metric` never. A set missing a measure its modality requires is not sent.
 */
export function sinSetToHevy(
  set: SetEntry,
  ctx: HevyExportCtx,
): { ok: true; set: HevyPostSet; notices: ExportNoticeCode[] } | { ok: false } {
  if (requiredMeasuresFor(ctx.modality).some((measure) => MEASURE_OF[measure](set) === null)) return { ok: false };
  const notices: ExportNoticeCode[] = [];
  const out: HevyPostSet = { type: SIN_TO_HEVY_SET_TYPE[set.setType] };
  for (const field of FIELDS[ctx.hevyType]) {
    if (field === "weight_kg") out.weight_kg = set.weightKg;
    else if (field === "reps") out.reps = ctx.rule === "calories_as_reps" ? set.calories : set.reps;
    else if (field === "duration_seconds") out.duration_seconds = set.durationS;
    else {
      const meters = set.distanceM;
      out.distance_meters = meters === null ? null : Math.round(meters);
      if (meters !== null && Math.abs(Math.round(meters) - meters) > 0.0005) notices.push("distance_rounded");
    }
  }
  if (set.rpe === null) out.rpe = null;
  else {
    const step = roundRpeForHevy(set.rpe);
    out.rpe = step;
    if (step === null) notices.push("rpe_dropped");
    else if (step !== set.rpe) notices.push("rpe_rounded");
  }
  return { ok: true, set: out, notices };
}
