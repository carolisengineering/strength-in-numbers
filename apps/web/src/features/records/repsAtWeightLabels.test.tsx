import type { PersonalRecord } from "@sin/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { recordRowLabels } from "./labels";
import { buildRecordLedger } from "./recordLedger";
import { RecordsSection } from "./RecordsSection";

const ROOT = "10000000-0000-4000-8000-0000000000f1";
const NBSP = " ";
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const reps = (atWeightKg: number, o: Partial<Record<keyof PersonalRecord, unknown>> = {}): PersonalRecord =>
  makePersonalRecord({
    exerciseId: ROOT,
    sourceExerciseId: ROOT,
    exerciseName: "Dumbbell Curl",
    recordType: "max_reps_at_weight",
    unit: "reps",
    value: 8,
    previousValue: 6,
    atWeightKg,
    ...o,
  });
const labelsOf = (records: PersonalRecord[], pref: "kg" | "lb") => records.map((r) => recordRowLabels(records, pref).get(r));
const success = (data: PersonalRecord[]) =>
  ({ isPending: false, isError: false, data, error: null, refetch: async () => undefined }) as unknown as UseQueryResult<PersonalRecord[]>;

// 20.4 kg reads 44.97 lb and 20.412 kg (45 lb logged in lb) reads 45.0006 lb: both "45 lb" at 0.1 lb.
describe("07.5 AC35 — two weights that read alike get 2 decimals (D12, minor 684)", () => {
  it("only the clashing pair is precise; a third weight keeps its plain label", () => {
    expect(labelsOf([reps(25), reps(20.412), reps(20.4)], "lb")).toEqual([`Most reps at 55.1${NBSP}lb`, `Most reps at 45${NBSP}lb`, `Most reps at 44.97${NBSP}lb`]);
  });
  it("a kg account never changes a label", () => {
    expect(labelsOf([reps(20.412), reps(20.4)], "kg")).toEqual([`Most reps at 20.412${NBSP}kg`, `Most reps at 20.4${NBSP}kg`]);
  });
  it("the ledger labels both rows of a lift precisely", () => {
    const sets = [makeSet({ reps: 8, weight: 20.412 }), makeSet({ reps: 9, weight: 20.4 })];
    const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Dumbbell Curl", sets }] });
    const e = workout.exercises[0]!;
    const own = (atWeightKg: number, i: number) => reps(atWeightKg, { exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, sourceSetId: sets[i]!.id, workoutId: workout.id });
    const ledger = buildRecordLedger({ records: [own(20.412, 0), own(20.4, 1)], workout, pref: "lb", section: "workouts" });
    expect(ledger.lifts[0]!.rows.map((r) => r.label)).toEqual([`Most reps at 45${NBSP}lb`, `Most reps at 44.97${NBSP}lb`]);
    expect(ledger.lifts[0]!.rows[1]!.spoken.startsWith(`Most reps at 44.97${NBSP}lb:`)).toBe(true);
  });
  it("the collapsed exercise page labels a shown weight by its hidden twin too", () => {
    // 20.4 kg is the newest weight; 20.412 kg is the oldest, behind Show all with 10 kg.
    const records = [reps(20.412, { achievedAt: at(1) }), reps(20.4, { achievedAt: at(20) }), ...[10, 12, 14, 16, 18].map((w, i) => reps(w, { achievedAt: at(10 + i) }))];
    render(<RecordsSection query={success(records)} unitPreference="lb" />);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(5);
    expect(rows.some((t) => t.startsWith(`Most reps at 44.97${NBSP}lb`))).toBe(true);
  });
});
