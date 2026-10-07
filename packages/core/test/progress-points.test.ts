import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeRecords, progressPoints, setRecordValueMilli, type RecordSet } from "../src/records.js";

const set = (over: Partial<RecordSet> = {}): RecordSet => ({
  setId: "s", workoutId: "w", modality: "weight_reps", weightKgMilli: 100_000, reps: 5, ...over,
});

describe("AC12 — setRecordValueMilli is candidate(), exported, unchanged", () => {
  it("returns the per-type milli values 07.0 defined", () => {
    expect(setRecordValueMilli("heaviest_weight", set())).toBe(100_000);
    expect(setRecordValueMilli("best_est_1rm", set())).toBe(116_667);
    expect(setRecordValueMilli("best_set_volume", set())).toBe(500_000);
    expect(setRecordValueMilli("max_reps", set())).toBeNull();
    expect(setRecordValueMilli("max_reps", set({ modality: "bodyweight_reps", weightKgMilli: null, reps: 12 }))).toBe(12_000);
    expect(setRecordValueMilli("best_est_1rm", set({ reps: 13 }))).toBeNull();
  });
  it("records.ts has exactly one per-type eligibility function, and computeRecords calls it", () => {
    const src = readFileSync(new URL("../src/records.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/function candidate\(/);
    expect(src.match(/export function setRecordValueMilli\(/g)).toHaveLength(1);
    const compute = src.slice(src.indexOf("export function computeRecords("));
    expect(compute).toContain("setRecordValueMilli(recordType, s)");
  });
});

describe("AC13/AC7 — progressPoints, hand-computed", () => {
  it("one point per workout in input order; per-workout max / sum", () => {
    // w1: 100×5, 90×8 → top 100.000; e1RM max(116.667, 114.000) = 116.667; volume 500 + 720 = 1220.000
    // w2: 105×1, 140×13 → top 140.000 (13 reps still counts for heaviest); e1RM only 105×1 = 108.500 (13 reps out of window); volume 105 + 1820 = 1925.000
    const pts = progressPoints([
      set({ setId: "a", workoutId: "w1", weightKgMilli: 100_000, reps: 5 }),
      set({ setId: "b", workoutId: "w1", weightKgMilli: 90_000, reps: 8 }),
      set({ setId: "c", workoutId: "w2", weightKgMilli: 105_000, reps: 1 }),
      set({ setId: "d", workoutId: "w2", weightKgMilli: 140_000, reps: 13 }),
    ]);
    expect(pts).toEqual([
      { workoutId: "w1", topSetWeightMilli: 100_000, bestE1rmMilli: 116_667, totalVolumeMilli: 1_220_000, maxRepsMilli: null },
      { workoutId: "w2", topSetWeightMilli: 140_000, bestE1rmMilli: 108_500, totalVolumeMilli: 1_925_000, maxRepsMilli: null },
    ]);
  });
  it("Epley window boundaries: 0 and 13 reps give no e1RM; 1 and 12 do", () => {
    const e1rm = (reps: number) => progressPoints([set({ reps })])[0]!.bestE1rmMilli;
    expect(e1rm(0)).toBeNull();
    expect(e1rm(1)).toBe(103_333);
    expect(e1rm(12)).toBe(140_000);
    expect(e1rm(13)).toBeNull();
  });
  it("maxReps for bodyweight_reps only; load metrics null there", () => {
    const [p] = progressPoints([
      set({ setId: "a", modality: "bodyweight_reps", weightKgMilli: null, reps: 8 }),
      set({ setId: "b", modality: "bodyweight_reps", weightKgMilli: null, reps: 10 }),
    ]);
    expect(p).toEqual({ workoutId: "w", topSetWeightMilli: null, bestE1rmMilli: null, totalVolumeMilli: null, maxRepsMilli: 10_000 });
  });
  it("lb-derived weight (135 lb → 61.235 kg) and an ineligible set mixed in", () => {
    const [p] = progressPoints([
      set({ setId: "a", weightKgMilli: 61_235, reps: 5 }), // volume 306.175
      set({ setId: "b", weightKgMilli: null, reps: 5 }), // half-filled: contributes nothing
    ]);
    expect(p).toMatchObject({ topSetWeightMilli: 61_235, totalVolumeMilli: 306_175 });
  });
  it("AC6 — working sets that fail every metric give an all-null point (D7)", () => {
    expect(progressPoints([set({ modality: "duration", weightKgMilli: null, reps: null })])).toEqual([
      { workoutId: "w", topSetWeightMilli: null, bestE1rmMilli: null, totalVolumeMilli: null, maxRepsMilli: null },
    ]);
  });
  it("empty input → []; non-contiguous workout throws", () => {
    expect(progressPoints([])).toEqual([]);
    expect(() =>
      progressPoints([set({ workoutId: "w1" }), set({ workoutId: "w2" }), set({ workoutId: "w1" })]),
    ).toThrow(/progressPoints: .*not contiguous/);
  });
});

describe("AC14 — totalVolume is deliberately outside the guarantee", () => {
  it("3 × 100 kg × 5 in one workout: series max volume 1500 ≠ best_set_volume 500", () => {
    const sets = ["a", "b", "c"].map((id) => set({ setId: id, workoutId: "w1" }));
    expect(progressPoints(sets)[0]!.totalVolumeMilli).toBe(1_500_000);
    expect(computeRecords(sets).find((r) => r.recordType === "best_set_volume")!.valueMilli).toBe(500_000);
  });
});
