import { RECORD_TYPE_VALUES, WorkoutSchema, type PersonalRecord } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { buildRecordLedger } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";
import { TolerantPersonalRecordsResponseSchema, TolerantUpdatedWorkoutSchema } from "./tolerantRecords";

const ROOT = "10000000-0000-4000-8000-0000000000c1";
const set = makeSet({ reps: 5, weight: 100 });
const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [set] }] });
const UNIT: Record<string, string> = { max_reps: "reps", max_calories: "cal", max_distance: "m", max_duration: "s" };
const everyType: PersonalRecord[] = RECORD_TYPE_VALUES.map((recordType) =>
  makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, sourceSetId: set.id, workoutId: workout.id, recordType, unit: UNIT[recordType] ?? "kg", value: 20, previousValue: 10 }),
);

describe("07.5 AC4 — no visible change with the seven current types", () => {
  it("a finish carrying all seven types parses whole, and its ledger is the one the strict parse gave", () => {
    const parsed = TolerantUpdatedWorkoutSchema.parse({ ...WorkoutSchema.parse(workout), newRecords: everyType });
    expect(parsed.newRecords).toEqual(everyType);
    expect(TolerantPersonalRecordsResponseSchema.parse({ records: everyType }).records).toEqual(everyType);

    const ledger = buildRecordLedger({ records: parsed.newRecords, workout, pref: "kg", section: "workouts" });
    expect(ledger).toEqual(buildRecordLedger({ records: everyType, workout, pref: "kg", section: "workouts" }));
    render(<RecordLedgerPanel heading={ledger.heading!} lifts={ledger.lifts} />);
    expect(screen.getByText(ledger.heading!)).toBeInTheDocument();
    expect(ledger.lifts[0]!.rows.map((r) => r.label)).toEqual(["Heaviest weight", "Est. 1-rep max", "Most reps", "Most calories", "Longest distance", "Longest hold"]);
  });
});
