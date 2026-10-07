import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setRecordValueMilli, type RecordSet } from "../src/records.js";

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
