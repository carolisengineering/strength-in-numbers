import type { RecordSet } from "../../src/records.js";

/** mulberry32 — fixed seeds keep failures reproducible (07.0 D21). Same
 * generator as records-property.test.ts (copied: that file must stay unmodified). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedWorkout { id: string; startedAt: number; sets: RecordSet[] }

export function history(seed: number): GeneratedWorkout[] {
  const rnd = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const modalities = ["weight_reps", "weighted_bodyweight", "bodyweight_reps", "duration"] as const;
  const workouts: GeneratedWorkout[] = [];
  const count = 1 + Math.floor(rnd() * 25);
  for (let w = 0; w < count; w++) {
    const id = `w${seed}-${String(w).padStart(2, "0")}`;
    const sets: RecordSet[] = [];
    const setCount = Math.floor(rnd() * 6);
    for (let s = 0; s < setCount; s++) {
      const modality = pick(modalities);
      sets.push({
        setId: `${id}-s${s}`,
        workoutId: id,
        modality,
        weightKgMilli: modality === "bodyweight_reps" || modality === "duration" ? null : pick([0, 2_500, 60_000, 61_235, 100_000]),
        reps: modality === "duration" ? null : pick([0, 1, 5, 12, 13]),
      });
    }
    workouts.push({ id, startedAt: Math.floor(rnd() * 10), sets });
  }
  return workouts;
}

/** Chronological flatten: (startedAt, id) — the loader's order. */
export const flatten = (ws: GeneratedWorkout[]): RecordSet[] =>
  [...ws].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).flatMap((w) => w.sets);
