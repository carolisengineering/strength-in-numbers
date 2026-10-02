import {
  SET_DISTANCE_MAX,
  SET_DURATION_S_MAX,
  SET_REPS_MAX,
  SET_WEIGHT_MAX,
  toCanonicalMeters,
  type CreateSet,
  type DistanceUnit,
  type Modality,
  type SetEntry,
  type SetType,
  type WeightUnit,
} from "@sin/core";
import { visibleMeasures } from "./measures";

export type DraftField = "weight" | "reps" | "distance" | "minutes" | "seconds" | "rpe";

/** What the lifter has typed but not yet logged. Strings, because "12." and "" are legitimate while typing. */
export interface SetDraft {
  weight: string;
  reps: string;
  distance: string;
  minutes: string;
  seconds: string;
  rpe: string;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  setType: SetType;
  /** Becomes the create's `clientGeneratedId`; minted per attempt, kept across retries (§6.5). */
  attemptKey: string;
}

export interface UnitDefaults {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}

export type SetBody = Omit<CreateSet, "clientGeneratedId" | "isComplete">;

export type ParseResult =
  | { ok: true; body: SetBody }
  | { ok: false; errors: Partial<Record<DraftField, string>> };

/** D26: the weight unit follows the preference; the distance unit is derived from it. */
export const unitDefaultsFor = (pref: "kg" | "lb"): UnitDefaults =>
  pref === "kg" ? { weightUnit: "kg", distanceUnit: "km" } : { weightUnit: "lb", distanceUnit: "mi" };

// Static messages: never echo what was typed.
const MSG = {
  required: "Required",
  number: "Enter a number",
  whole: "Enter a whole number",
  negative: "Can't be negative",
  decimals: "Use up to 3 decimal places",
  large: "Too large",
  seconds: "Seconds must be 0–59",
  rpe: "RPE must be 1–10",
} as const;

type Parsed = { value: number } | { error: string };

function parseDecimal(raw: string, max: number): Parsed {
  const s = raw.trim().replace(",", ".");
  if (s === "") return { error: MSG.required };
  if (/^-\d+(\.\d+)?$/.test(s)) return { error: MSG.negative };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: MSG.number };
  if ((s.split(".")[1]?.length ?? 0) > 3) return { error: MSG.decimals };
  const value = Number(s);
  return value > max ? { error: MSG.large } : { value };
}

function parseWhole(raw: string, max: number): Parsed {
  const s = raw.trim();
  if (s === "") return { error: MSG.required };
  if (/^-\d+$/.test(s)) return { error: MSG.negative };
  if (/^\d+[.,]\d*$/.test(s)) return { error: MSG.whole };
  if (!/^\d+$/.test(s)) return { error: MSG.number };
  const value = Number(s);
  return value > max ? { error: MSG.large } : { value };
}

export function parseDraft(modality: Modality, d: SetDraft): ParseResult {
  const errors: Partial<Record<DraftField, string>> = {};
  const body: SetBody = { setType: d.setType };
  const visible = visibleMeasures(modality);

  if (visible.includes("weight")) {
    const p = parseDecimal(d.weight, SET_WEIGHT_MAX);
    if ("error" in p) errors.weight = p.error;
    else {
      body.weight = p.value;
      body.weightUnit = d.weightUnit;
    }
  }
  if (visible.includes("reps")) {
    const p = parseWhole(d.reps, SET_REPS_MAX);
    if ("error" in p) errors.reps = p.error;
    else body.reps = p.value;
  }
  if (visible.includes("distance")) {
    const p = parseDecimal(d.distance, SET_DISTANCE_MAX);
    if ("error" in p) errors.distance = p.error;
    else if (toCanonicalMeters(p.value, d.distanceUnit) > SET_DISTANCE_MAX) errors.distance = MSG.large;
    else {
      body.distance = p.value;
      body.distanceUnit = d.distanceUnit;
    }
  }
  if (visible.includes("durationS")) {
    const minutesEmpty = d.minutes.trim() === "";
    const secondsEmpty = d.seconds.trim() === "";
    if (minutesEmpty && secondsEmpty) {
      errors.minutes = MSG.required;
    } else {
      const m = minutesEmpty ? { value: 0 } : parseWhole(d.minutes, SET_DURATION_S_MAX);
      const s = secondsEmpty ? { value: 0 } : parseWhole(d.seconds, 59);
      if ("error" in m) errors.minutes = m.error;
      if ("error" in s) errors.seconds = s.error === MSG.large ? MSG.seconds : s.error;
      if (!("error" in m) && !("error" in s)) {
        const total = m.value * 60 + s.value;
        if (total > SET_DURATION_S_MAX) errors.minutes = MSG.large;
        else body.durationS = total;
      }
    }
  }
  if (d.rpe.trim() !== "") {
    const s = d.rpe.trim().replace(",", ".");
    const value = Number(s);
    if (!/^\d+(\.\d)?$/.test(s) || value < 1 || value > 10) errors.rpe = MSG.rpe;
    else body.rpe = value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, body };
}

/** The API names measures; the form has inputs. A server unit error belongs under its value's input. */
const INPUT_FOR_MEASURE: Record<string, DraftField> = {
  weight: "weight",
  weightUnit: "weight",
  reps: "reps",
  distance: "distance",
  distanceUnit: "distance",
  durationS: "minutes",
  rpe: "rpe",
};

/**
 * Which input a server field path (`weight`, `body.reps`, `/rpe`) belongs to, or `null` for a path
 * that matches none (shown as a form-level message instead).
 */
export function draftFieldForPath(path: string): DraftField | null {
  const last = path.split(/[./]/).at(-1) ?? "";
  return Object.hasOwn(INPUT_FOR_MEASURE, last) ? (INPUT_FOR_MEASURE[last] ?? null) : null;
}

/**
 * Only what changed, for `PATCH /v1/sets/{id}`; `null` when nothing did (the caller sends no request).
 * RPE is the one optional field: a body without it means "cleared".
 */
export function diffForPatch(set: SetEntry, body: SetBody): Partial<SetBody> | null {
  const out: Partial<SetBody> = {};
  if (body.setType !== undefined && body.setType !== set.setType) out.setType = body.setType;
  if (body.weight !== undefined && body.weight !== set.weight) out.weight = body.weight;
  if (body.weightUnit !== undefined && body.weightUnit !== set.weightUnit) out.weightUnit = body.weightUnit;
  if (body.reps !== undefined && body.reps !== set.reps) out.reps = body.reps;
  if (body.distance !== undefined && body.distance !== set.distance) out.distance = body.distance;
  if (body.distanceUnit !== undefined && body.distanceUnit !== set.distanceUnit) out.distanceUnit = body.distanceUnit;
  if (body.durationS !== undefined && body.durationS !== set.durationS) out.durationS = body.durationS;
  const rpe = body.rpe ?? null;
  if (rpe !== set.rpe) out.rpe = rpe;
  return Object.keys(out).length === 0 ? null : out;
}

const text = (n: number | null): string => (n === null ? "" : String(n));

/** The one place copy-forward and edit-sheet prefill happen. A null measure becomes "" (never "0"). */
export function draftFromSet(set: SetEntry | null, defaults: UnitDefaults, attemptKey: string): SetDraft {
  if (set === null) {
    return {
      weight: "",
      reps: "",
      distance: "",
      minutes: "",
      seconds: "",
      rpe: "",
      ...defaults,
      setType: "working",
      attemptKey,
    };
  }
  return {
    weight: text(set.weight),
    reps: text(set.reps),
    distance: text(set.distance),
    minutes: set.durationS === null ? "" : String(Math.floor(set.durationS / 60)),
    seconds: set.durationS === null ? "" : String(set.durationS % 60),
    rpe: text(set.rpe),
    weightUnit: set.weightUnit ?? defaults.weightUnit,
    distanceUnit: set.distanceUnit ?? defaults.distanceUnit,
    setType: "working",
    attemptKey,
  };
}

export type DraftAction =
  | { type: "edit"; field: keyof Omit<SetDraft, "attemptKey">; value: string }
  | { type: "reset"; from: SetEntry | null; defaults: UnitDefaults }
  | { type: "logged"; set: SetEntry }
  /** A set was logged but the lifter has typed since the tap: keep their values, only re-mint the key. */
  | { type: "rekey" };

/** `newKey` is injected so tests (and 06.2) control key minting. */
export function createDraftReducer(newKey: () => string) {
  return (state: SetDraft, action: DraftAction): SetDraft => {
    switch (action.type) {
      case "edit":
        return { ...state, [action.field]: action.value } as SetDraft;
      case "reset":
        return draftFromSet(action.from, action.defaults, newKey());
      case "rekey":
        return { ...state, attemptKey: newKey() };
      case "logged": {
        const next = draftFromSet(
          action.set,
          { weightUnit: state.weightUnit, distanceUnit: state.distanceUnit },
          newKey(),
        );
        return { ...next, rpe: "" }; // RPE is per set: not copied forward
      }
    }
  };
}
