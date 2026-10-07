/**
 * Personal-record math (Spec 07.0 §6.1, DESIGN §4.5). Pure; one implementation
 * shared by the API's finish / delete / rebuild paths and, later, the clients.
 *
 * Every value is an integer in thousandths ("milli"): kg × 1000 for the load
 * types, reps × kg × 1000 for set volume, reps × 1000 for max_reps — so one
 * `numeric(12,3)` column and one formatter serve all four, and every
 * comparison is exact (D3). Magnitudes stay below 3.3e11, far inside
 * Number.MAX_SAFE_INTEGER, so no BigInt is needed.
 */
import { RECORD_TYPE_VALUES, RECORD_UNIT_BY_TYPE, type RecordType, type RecordUnit } from "./enums.js";

/** One qualifying set (working, in a finished workout), caller-sorted by
 * (workout started_at, workout id, workout_exercise position, set_number). */
export interface RecordSet {
  setId: string;
  workoutId: string;
  /** The set's workout_exercise.modality_snapshot. */
  modality: string;
  weightKgMilli: number | null;
  reps: number | null;
}

export interface ComputedRecord {
  recordType: RecordType;
  valueMilli: number;
  unit: RecordUnit;
  setId: string;
  workoutId: string;
  /** Best value of this type over strictly-earlier workouts (D16). */
  previousValueMilli: number | null;
}

const DECIMAL_3 = /^(\d+)(?:\.(\d{1,3}))?$/;

/** `"61.235"` → `61235`. Accepts Postgres `numeric(7,3)::text` output. */
export function parseWeightKgMilli(decimalString: string): number {
  const m = DECIMAL_3.exec(decimalString);
  if (!m) throw new Error(`not a non-negative decimal with ≤ 3 places: ${JSON.stringify(decimalString)}`);
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(milli)) throw new Error(`decimal out of range: ${decimalString}`);
  return milli;
}

/** `61235` → `"61.235"` — string arithmetic, no division. */
export function milliToDecimalString(milli: number): string {
  if (!Number.isSafeInteger(milli) || milli < 0) {
    throw new Error(`milli must be a non-negative safe integer: ${milli}`);
  }
  const digits = String(milli).padStart(4, "0");
  return `${digits.slice(0, -3)}.${digits.slice(-3)}`;
}

/** Floor division of non-negative safe integers. The IEEE quotient of two
 * integers below 2^53 is correctly rounded, so flooring it is exact. */
function divFloor(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Epley e1RM in milli-kg, rounded half-up: floor((w × (30 + reps) + 15) / 30).
 * `null` unless reps is an integer in 1..12 (DESIGN §4.5). */
export function estimate1rm(weightKgMilli: number, reps: number): number | null {
  if (!Number.isInteger(reps) || reps < 1 || reps > 12) return null;
  return divFloor(weightKgMilli * (30 + reps) + 15, 30);
}

const LOAD_MODALITIES = new Set(["weight_reps", "weighted_bodyweight"]);

/**
 * The one definition of a set's volume (Spec 07.1 D4): reps × weight in milli,
 * for load modalities only, with reps an integer ≥ 1 and weight > 0. 07.0's
 * best_set_volume and 07.1's history totalVolume both go through it. Callers
 * pass working sets only.
 */
export function setVolumeMilli(modality: string, weightKgMilli: number | null, reps: number | null): number | null {
  if (!LOAD_MODALITIES.has(modality)) return null;
  if (reps === null || !Number.isInteger(reps) || reps < 1) return null;
  if (weightKgMilli === null || weightKgMilli <= 0) return null;
  return reps * weightKgMilli;
}

/** Sum of `setVolumeMilli` over `sets`; `null` when no set qualifies (07.1 §5). */
export function sumVolumeMilli(
  sets: Iterable<{ modality: string; weightKgMilli: number | null; reps: number | null }>,
): number | null {
  let total: number | null = null;
  for (const s of sets) {
    const v = setVolumeMilli(s.modality, s.weightKgMilli, s.reps);
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
}

/** The set's candidate value (milli) for one record type, or null when
 * ineligible (07.0 §6.1 table, D5). Exported for Spec 07.2's progress series —
 * one per-set rule for PRs and charts. */
export function setRecordValueMilli(recordType: RecordType, s: RecordSet): number | null {
  const reps = s.reps !== null && Number.isInteger(s.reps) && s.reps >= 1 ? s.reps : null;
  if (recordType === "max_reps") {
    return s.modality === "bodyweight_reps" && reps !== null ? reps * 1000 : null;
  }
  if (recordType === "best_set_volume") {
    // Spec 07.1 D4: setVolumeMilli alone decides a set's volume, so the PR
    // and the history list can never disagree about which sets count.
    return setVolumeMilli(s.modality, s.weightKgMilli, s.reps);
  }
  if (!LOAD_MODALITIES.has(s.modality) || reps === null) return null;
  const w = s.weightKgMilli;
  if (w === null || w <= 0) return null;
  switch (recordType) {
    case "heaviest_weight":
      return w;
    case "best_est_1rm":
      return estimate1rm(w, reps);
  }
}

/** Contiguous per-workout runs of `sets`, in input order. Throws if a
 * workout's sets reappear after another workout began (a caller bug). */
function groupByWorkout(sets: readonly RecordSet[], caller: string): RecordSet[][] {
  const workouts: RecordSet[][] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    const current = workouts[workouts.length - 1];
    if (current && current[0]!.workoutId === s.workoutId) {
      current.push(s);
      continue;
    }
    if (seen.has(s.workoutId)) {
      throw new Error(`${caller}: sets of workout ${s.workoutId} are not contiguous`);
    }
    seen.add(s.workoutId);
    workouts.push([s]);
  }
  return workouts;
}

/**
 * One lineage's records (§6.1). Walks workouts in input order; within a
 * workout the earliest best set wins (strict `>`); a workout's best becomes
 * the holder only if it beats the running best of earlier workouts.
 * Throws if a workout's sets are not contiguous (a caller bug).
 */
export function computeRecords(sets: readonly RecordSet[]): ComputedRecord[] {
  const workouts = groupByWorkout(sets, "computeRecords");

  const out: ComputedRecord[] = [];
  for (const recordType of RECORD_TYPE_VALUES) {
    let runningBest: number | null = null;
    let holder: ComputedRecord | null = null;
    for (const group of workouts) {
      let best: { value: number; set: RecordSet } | null = null;
      for (const s of group) {
        const v = setRecordValueMilli(recordType, s);
        if (v !== null && v > 0 && (best === null || v > best.value)) best = { value: v, set: s };
      }
      if (best === null) continue;
      if (runningBest === null || best.value > runningBest) {
        holder = {
          recordType,
          valueMilli: best.value,
          unit: RECORD_UNIT_BY_TYPE[recordType],
          setId: best.set.setId,
          workoutId: best.set.workoutId,
          previousValueMilli: runningBest,
        };
        runningBest = best.value;
      }
    }
    if (holder) out.push(holder);
  }
  return out;
}

/** One chart point (Spec 07.2 §5): a workout's best per metric, integer milli. */
export interface ProgressPointMilli {
  workoutId: string;
  topSetWeightMilli: number | null;
  bestE1rmMilli: number | null;
  /** A SESSION SUM (sumVolumeMilli) — not best_set_volume's single set. */
  totalVolumeMilli: number | null;
  /** reps × 1000, bodyweight_reps only. */
  maxRepsMilli: number | null;
}

/** The workout's best value of one type (computeRecords' own `v > 0` guard). */
function bestOf(recordType: RecordType, group: readonly RecordSet[]): number | null {
  let best: number | null = null;
  for (const s of group) {
    const v = setRecordValueMilli(recordType, s);
    if (v !== null && v > 0 && (best === null || v > best)) best = v;
  }
  return best;
}

/**
 * Spec 07.2 §6.2 — one point per workout, in input order, from the SAME
 * per-set function as computeRecords, so the series max of topSetWeight /
 * bestE1rm / maxReps equals the heaviest_weight / best_est_1rm / max_reps PR
 * (AC14). Input: one lineage's working sets, sorted as computeRecords needs.
 * Each point depends only on its own workout, so a date-range filter upstream
 * changes which points appear, never their values (D10).
 */
export function progressPoints(sets: readonly RecordSet[]): ProgressPointMilli[] {
  return groupByWorkout(sets, "progressPoints").map((group) => ({
    workoutId: group[0]!.workoutId,
    topSetWeightMilli: bestOf("heaviest_weight", group),
    bestE1rmMilli: bestOf("best_est_1rm", group),
    totalVolumeMilli: sumVolumeMilli(group),
    maxRepsMilli: bestOf("max_reps", group),
  }));
}
