import { WorkoutSchema } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { groupByExercise } from "../progress/exercises";
import { recordLabel, recordParts, recordRowLabel, sortRecords } from "./labels";
import { buildRecordLedger } from "./recordLedger";
import { RecordRows } from "./RecordRows";
import { TolerantPersonalRecordsResponseSchema, TolerantUpdatedWorkoutSchema } from "./tolerantRecords";

const ROOT = "10000000-0000-4000-8000-0000000000d1";
const reps = (atWeightKg: number, value: number, previousValue: number | null = null) =>
  makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Lateral Raise", recordType: "max_reps_at_weight", unit: "reps", value, previousValue, atWeightKg });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("07.5 AC31 — the web labels and orders it", () => {
  it("recordLabel names the type alone; recordRowLabel names the weight in the profile unit", () => {
    expect(recordLabel("max_reps_at_weight")).toBe("Most reps at a weight");
    expect(recordRowLabel(reps(32.5, 14), "kg")).toBe("Most reps at 32.5 kg");
    expect(recordRowLabel(reps(31.751, 14), "lb")).toBe("Most reps at 70 lb");
    expect(recordRowLabel(makePersonalRecord({ recordType: "heaviest_weight" }), "kg")).toBe("Heaviest weight");
  });

  it("recordParts reads 14 reps, was 12 reps, under the weight's label", () => {
    expect(recordParts(reps(12.5, 14, 12), "kg")).toEqual({ label: "Most reps at 12.5 kg", value: "14 reps", was: "12 reps", first: false });
  });

  it("sortRecords keeps the type order, then the heavier weight first", () => {
    const heaviest = makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Lateral Raise", recordType: "heaviest_weight", value: 15 });
    const light = reps(12.5, 14);
    const heavy = reps(15, 7);
    expect(sortRecords([light, heavy, heaviest]).map((r) => [r.recordType, r.atWeightKg])).toEqual([
      ["heaviest_weight", null],
      ["max_reps_at_weight", 15],
      ["max_reps_at_weight", 12.5],
    ]);
  });

  it("RecordRows draws two weights of one lift as two rows, with no duplicate key", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RecordRows records={[reps(15, 7), reps(12.5, 14, 12)]} unitPreference="kg" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Most reps at 15 kg")).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it("the Records list headline stays the heaviest weight", () => {
    const heaviest = makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Lateral Raise", recordType: "heaviest_weight", value: 15 });
    expect(groupByExercise([reps(12.5, 14, 12), heaviest])[0]!.headline).toBe(heaviest);
  });

  it("the tolerant parse keeps max_reps_at_weight now that it is known", () => {
    const record = reps(12.5, 14, 12);
    expect(TolerantPersonalRecordsResponseSchema.parse({ records: [record] }).records).toEqual([record]);
    const detail = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z" });
    expect(TolerantUpdatedWorkoutSchema.parse({ ...WorkoutSchema.parse(detail), newRecords: [record] }).newRecords).toEqual([record]);
  });
});

describe("07.5 AC31 — the summary's ledger shows nothing for the new type until Phase C", () => {
  it("a beaten reps row alone draws no heading, no lift and no first-time line", () => {
    const set = makeSet({ reps: 14, weight: 12.5 });
    const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Lateral Raise", sets: [set] }] });
    const first = { ...reps(15, 7), sourceSetId: set.id };
    const ledger = buildRecordLedger({ records: [{ ...reps(12.5, 14, 12), sourceSetId: set.id }, first], workout, pref: "kg", section: "workouts" });
    expect(ledger.heading).toBeNull();
    expect(ledger.lifts).toEqual([]);
    expect(ledger.firsts).toEqual([]);
  });
});
