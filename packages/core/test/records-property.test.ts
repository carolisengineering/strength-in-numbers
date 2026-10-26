import { describe, expect, it } from "vitest";
import { RECORD_TYPE_VALUES, RECORD_UNIT_BY_TYPE } from "../src/enums.js";
import { computeRecords, estimate1rm, type ComputedRecord, type RecordSet } from "../src/records.js";

/** mulberry32 — a fixed seed list keeps failures reproducible (D21). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REP_MODALITIES = new Set(["weight_reps", "weighted_bodyweight", "bodyweight_reps"]);
const NEW_MODALITIES = new Set(["calories", "weight_distance", "weight_duration"]);

interface Workout { id: string; startedAt: number; sets: RecordSet[] }

function history(seed: number): Workout[] {
  const rnd = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const modalities = [
    "weight_reps",
    "weighted_bodyweight",
    "bodyweight_reps",
    "duration",
    "calories",
    "weight_distance",
    "weight_duration",
  ] as const;
  const workouts: Workout[] = [];
  const count = 1 + Math.floor(rnd() * 25);
  for (let w = 0; w < count; w++) {
    const id = `w${seed}-${String(w).padStart(2, "0")}`;
    const sets: RecordSet[] = [];
    const setCount = Math.floor(rnd() * 6);
    for (let s = 0; s < setCount; s++) {
      const modality = pick(modalities);
      // a small value space forces ties
      sets.push({
        setId: `${id}-s${s}`,
        workoutId: id,
        modality,
        weightKgMilli:
          modality === "bodyweight_reps" || modality === "duration" || modality === "calories"
            ? null
            : pick([0, 2_500, 60_000, 61_235, 100_000]),
        reps: REP_MODALITIES.has(modality) ? pick([0, 1, 5, 12, 13]) : null,
        calories: modality === "calories" ? pick([0, 1, 20, 25]) : null,
        distanceMMilli: modality === "weight_distance" ? pick([0, 1, 40_000, 60_000]) : null,
        durationS: modality === "weight_duration" || modality === "duration" ? pick([0, 1, 90, 600]) : null,
      });
    }
    // started_at may repeat and arrive out of order (backdated sessions)
    workouts.push({ id, startedAt: Math.floor(rnd() * 10), sets });
  }
  return workouts;
}

const chronological = (ws: Workout[]) =>
  [...ws].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const flatten = (ws: Workout[]) => chronological(ws).flatMap((w) => w.sets);

/** Brute force: for each type, scan all sets for the max, earliest wins; the
 * previous value is the max over sets in strictly-earlier workouts. */
function reference(ws: Workout[]): ComputedRecord[] {
  const ordered = chronological(ws);
  const value = (t: (typeof RECORD_TYPE_VALUES)[number], s: RecordSet): number | null => {
    const reps = s.reps !== null && s.reps >= 1 ? s.reps : null;
    // Spec 05.3 §6.2: the new types read their own measure only.
    if (t === "max_calories") return s.modality === "calories" && (s.calories ?? 0) >= 1 ? s.calories! * 1000 : null;
    if (t === "max_distance") return s.modality === "weight_distance" && (s.distanceMMilli ?? 0) > 0 ? s.distanceMMilli! : null;
    if (t === "max_duration") return s.modality === "weight_duration" && (s.durationS ?? 0) >= 1 ? s.durationS! * 1000 : null;
    if (t === "max_reps") return s.modality === "bodyweight_reps" && reps !== null ? reps * 1000 : null;
    const w = s.weightKgMilli;
    if (t === "heaviest_weight") {
      if (w === null || w <= 0) return null;
      if (s.modality === "weight_distance") return (s.distanceMMilli ?? 0) > 0 ? w : null;
      if (s.modality === "weight_duration") return (s.durationS ?? 0) >= 1 ? w : null;
    }
    if (!["weight_reps", "weighted_bodyweight"].includes(s.modality) || reps === null) return null;
    if (w === null || w <= 0) return null;
    if (t === "heaviest_weight") return w;
    if (t === "best_est_1rm") return estimate1rm(w, reps);
    return reps * w;
  };
  const out: ComputedRecord[] = [];
  for (const t of RECORD_TYPE_VALUES) {
    let best: { v: number; s: RecordSet; wi: number } | null = null;
    ordered.forEach((w, wi) =>
      w.sets.forEach((s) => {
        const v = value(t, s);
        if (v !== null && v > 0 && (best === null || v > best.v)) best = { v, s, wi };
      }),
    );
    if (best === null) continue;
    const b = best as { v: number; s: RecordSet; wi: number };
    let prev: number | null = null;
    ordered.slice(0, b.wi).forEach((w) =>
      w.sets.forEach((s) => {
        const v = value(t, s);
        if (v !== null && v > 0 && (prev === null || v > prev)) prev = v;
      }),
    );
    out.push({ recordType: t, valueMilli: b.v, unit: RECORD_UNIT_BY_TYPE[t], setId: b.s.setId, workoutId: b.s.workoutId, previousValueMilli: prev });
  }
  return out;
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("AC9 — rebuild ≡ live (seeded property test)", () => {
  it.each(SEEDS)("seed %i: (a) equals the brute-force reference", (seed) => {
    const ws = history(seed);
    expect(computeRecords(flatten(ws))).toEqual(reference(ws));
  });

  it.each(SEEDS)("seed %i: (b) every arrival prefix equals a fresh compute of that prefix", (seed) => {
    // A live system sees workouts arrive one at a time and recomputes the
    // lineage from everything finished so far; that must equal the reference
    // for the same set of workouts.
    const ws = history(seed);
    for (let k = 1; k <= ws.length; k++) {
      const arrived = ws.slice(0, k);
      expect(computeRecords(flatten(arrived))).toEqual(reference(arrived));
    }
  });

  it.each(SEEDS)("seed %i: (c) invariant under arrival order", (seed) => {
    const ws = history(seed);
    expect(computeRecords(flatten([...ws].reverse()))).toEqual(computeRecords(flatten(ws)));
  });
  it.each(SEEDS)("seed %i: 05.3 — no e1RM, set volume or max reps is ever held by a new-type set", (seed) => {
    const sets = flatten(history(seed));
    const modalityOf = new Map(sets.map((s) => [s.setId, s.modality]));
    for (const r of computeRecords(sets)) {
      if (r.recordType === "best_est_1rm" || r.recordType === "best_set_volume" || r.recordType === "max_reps") {
        expect(NEW_MODALITIES.has(modalityOf.get(r.setId)!)).toBe(false);
      }
    }
  });
});
