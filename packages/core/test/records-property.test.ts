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

interface Workout { id: string; startedAt: number; sets: RecordSet[] }

function history(seed: number): Workout[] {
  const rnd = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const modalities = ["weight_reps", "weighted_bodyweight", "bodyweight_reps", "duration"] as const;
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
        weightKgMilli: modality === "bodyweight_reps" || modality === "duration" ? null : pick([0, 2_500, 60_000, 61_235, 100_000]),
        reps: modality === "duration" ? null : pick([0, 1, 5, 12, 13]),
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
    if (t === "max_reps") return s.modality === "bodyweight_reps" && reps !== null ? reps * 1000 : null;
    if (!["weight_reps", "weighted_bodyweight"].includes(s.modality) || reps === null) return null;
    if (s.weightKgMilli === null || s.weightKgMilli <= 0) return null;
    if (t === "heaviest_weight") return s.weightKgMilli;
    if (t === "best_est_1rm") return estimate1rm(s.weightKgMilli, reps);
    return reps * s.weightKgMilli;
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
});
