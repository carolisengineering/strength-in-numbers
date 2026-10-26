import { describe, expect, it } from "vitest";
import { computeRecords, progressPoints, type ProgressPointMilli } from "../src/records.js";
import { flatten, history } from "./helpers/history-generator.js";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const PAIRS = [
  ["topSetWeightMilli", "heaviest_weight"],
  ["bestE1rmMilli", "best_est_1rm"],
  ["maxRepsMilli", "max_reps"],
] as const;
const NEW_PAIRS = [
  ["topSetWeightMilli", "heaviest_weight"],
  ["maxCaloriesMilli", "max_calories"],
  ["maxDistanceMilli", "max_distance"],
  ["maxDurationMilli", "max_duration"],
] as const;
type MetricKey = (typeof PAIRS)[number][0] | (typeof NEW_PAIRS)[number][0];

const maxOf = (pts: ProgressPointMilli[], key: MetricKey) =>
  pts.reduce<number | null>((m, p) => (p[key] === null ? m : m === null || p[key]! > m ? p[key] : m), null);

describe("AC14 — series max equals the PR, for three metrics", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const sets = flatten(history(seed));
    const points = progressPoints(sets);
    const records = computeRecords(sets);
    for (const [key, type] of PAIRS) {
      const pr = records.find((r) => r.recordType === type);
      expect(maxOf(points, key), `${type}`).toBe(pr ? pr.valueMilli : null); // null everywhere ⇔ absent
    }
  });
  it.each(SEEDS)("seed %i: one point per workout that has any set, in chronological order", (seed) => {
    const sets = flatten(history(seed));
    const ids = [...new Set(sets.map((s) => s.workoutId))];
    expect(progressPoints(sets).map((p) => p.workoutId)).toEqual(ids);
  });
});

describe("05.3 AC32 — series max equals the PR for the new types too", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const sets = flatten(history(seed, { withNewModalities: true }));
    const points = progressPoints(sets);
    const records = computeRecords(sets);
    for (const [key, type] of [...PAIRS, ...NEW_PAIRS]) {
      const pr = records.find((r) => r.recordType === type);
      expect(maxOf(points, key), `${type}`).toBe(pr ? pr.valueMilli : null);
    }
  });
  it.each(SEEDS)("seed %i: a date range (a contiguous run of workouts) changes which points appear, never their values", (seed) => {
    const sets = flatten(history(seed, { withNewModalities: true }));
    const all = progressPoints(sets);
    const ids = all.map((p) => p.workoutId);
    const kept = new Set(ids.slice(Math.floor(ids.length / 3), Math.ceil((2 * ids.length) / 3) + 1));
    const sub = progressPoints(sets.filter((s) => kept.has(s.workoutId)));
    expect(sub).toEqual(all.filter((p) => kept.has(p.workoutId)));
  });
});
