import type { PersonalRecord } from "@sin/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { recordRowLabel } from "./labels";
import { buildRecordLedger } from "./recordLedger";
import { RecordsSection } from "./RecordsSection";

const ROOT = "10000000-0000-4000-8000-0000000000f1";
const NBSP = " ";
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
const success = (data: PersonalRecord[]) =>
  ({ isPending: false, isError: false, data, error: null, refetch: async () => undefined }) as unknown as UseQueryResult<PersonalRecord[]>;

// 45 lb logged in lb is stored as 20.412 kg and reads back as 45 lb; 20.4 kg logged in kg reads 45 lb at 0.1 lb too, but
// 45 lb is 20.412 kg, not 20.4, so it reads 44.97 lb.
describe("07.5 AC35 — a weight that doesn't read back exactly gets 2 decimals in lb (D12, minor 684)", () => {
  it("a weight logged as its lb figure stays plain; one logged in kg shows 0.01 lb", () => {
    expect(recordRowLabel(reps(20.412), "lb")).toBe(`Most reps at 45${NBSP}lb`);
    expect(recordRowLabel(reps(31.751), "lb")).toBe(`Most reps at 70${NBSP}lb`);
    expect(recordRowLabel(reps(46.493), "lb")).toBe(`Most reps at 102.5${NBSP}lb`);
    expect(recordRowLabel(reps(20.4), "lb")).toBe(`Most reps at 44.97${NBSP}lb`);
    expect(recordRowLabel(reps(20), "lb")).toBe(`Most reps at 44.09${NBSP}lb`);
  });
  it("D12's accepted case: 102.058 kg and 102.06 kg both read 225 lb (minor 691)", () => {
    // 102.06 kg is 225.004 lb: it doesn't read back from 225, so it gets 0.01 lb, which still rounds to 225. D12 accepts
    // two weights a few grams apart sharing a label.
    expect(recordRowLabel(reps(102.058), "lb")).toBe(`Most reps at 225${NBSP}lb`);
    expect(recordRowLabel(reps(102.06), "lb")).toBe(recordRowLabel(reps(102.058), "lb"));
  });
  it("a kg account never changes a label", () => {
    expect([reps(20.412), reps(20.4)].map((r) => recordRowLabel(r, "kg"))).toEqual([`Most reps at 20.412${NBSP}kg`, `Most reps at 20.4${NBSP}kg`]);
  });
  it("the summary labels a weight as the page does, without seeing the page's other rows", () => {
    // The review's case: an earlier 20.412 kg record exists; today beats 20.4 kg. The summary sees only today's row.
    const set = makeSet({ reps: 9, weight: 20.4 });
    const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Dumbbell Curl", sets: [set] }] });
    const e = workout.exercises[0]!;
    const today = reps(20.4, { exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, sourceSetId: set.id, workoutId: workout.id, value: 9, previousValue: 8 });
    const ledger = buildRecordLedger({ records: [today], workout, pref: "lb", section: "workouts" });
    expect(ledger.lifts[0]!.rows.map((r) => r.label)).toEqual([`Most reps at 44.97${NBSP}lb`]);
    render(<RecordsSection query={success([reps(20.412, { value: 7, previousValue: null }), reps(20.4, { value: 9, previousValue: 8 })])} unitPreference="lb" />);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows.map((t) => t.split(":")[0])).toEqual([`Most reps at 45${NBSP}lb`, `Most reps at 44.97${NBSP}lb`]);
  });
});
