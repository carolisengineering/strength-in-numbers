import type { PersonalRecord } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { groupByExercise, headlineText } from "../progress/exercises";
import { buildRecordLedger } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";

const ROOT = "10000000-0000-4000-8000-0000000000c1";
const carry = makeSet({ reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 });
const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_distance", name: "Farmer Carry", sets: [carry] }] });
const rec = (o: Partial<Record<keyof PersonalRecord, unknown>>) =>
  makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Farmer Carry", previousValue: null, sourceSetId: carry.id, ...o });
const ledgerOf = (records: PersonalRecord[]) => buildRecordLedger({ records, workout, pref: "kg", section: "workouts" });
const unitOf = (recordType: string) => (recordType === "max_reps" ? "reps" : recordType === "max_calories" ? "cal" : recordType === "max_distance" ? "m" : recordType === "max_duration" ? "s" : "kg");

// Spec 17.6 replaces the 18.1 record cards with the ledger; these keep 18.1's type coverage against it.
describe("18.1 AC29 — the ledger for the new types", () => {
  it("rows run heaviest, est. 1-rep max, most reps, calories, distance, duration", () => {
    const every = (["max_duration", "max_distance", "max_calories", "max_reps", "best_est_1rm", "heaviest_weight"] as const).map((recordType) => rec({ recordType, unit: unitOf(recordType), value: 20, previousValue: 10 }));
    expect(ledgerOf(every).lifts[0]!.rows.map((r) => r.label)).toEqual(["Heaviest weight", "Est. 1-rep max", "Most reps", "Most calories", "Longest distance", "Longest hold"]);
  });
  it("a calories row reads its old and new values in cal", () => {
    expect(ledgerOf([rec({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120, previousValue: 115 })]).lifts[0]!.rows[0]).toMatchObject({ label: "Most calories", oldText: "115", newText: "120 cal", gainText: "+5 cal" });
  });
  it("a carry with both records has two rows, and one source line for its set", () => {
    const l = ledgerOf([rec({ recordType: "heaviest_weight", unit: "kg", value: 24, previousValue: 20 }), rec({ recordType: "max_distance", unit: "m", value: 40, previousValue: 30 })]);
    expect(l.lifts[0]!.rows.map((r) => r.label)).toEqual(["Heaviest weight", "Longest distance"]);
    expect(l.lifts[0]!.sourceText).toBe("from your 24 kg · 40 m");
  });
  it("a first-ever carry with only a distance is a quiet line", () => {
    expect(ledgerOf([rec({ recordType: "max_distance", unit: "m", value: 40 })]).firsts[0]!.text).toBe("First time logged: Farmer Carry 40 m");
  });
  it("a hold reads in words on both sides, and renders", () => {
    const l = ledgerOf([rec({ exerciseName: "Hold", recordType: "max_duration", unit: "s", value: 105, previousValue: 90 })]);
    expect(l.lifts[0]!.rows[0]).toMatchObject({ label: "Longest hold", oldText: "1 min 30 s", newText: "1 min 45 s", gainText: "+15 s" });
    render(<RecordLedgerPanel heading={l.heading!} lifts={l.lifts} />);
    expect(screen.getByText("Longest hold: was 1 min 30 s, now 1 min 45 s, up 15 s")).toBeInTheDocument();
  });
});

describe("18.1 AC30 — Progress list headline", () => {
  it("an exercise with only a calories record reads Most calories 120 cal · Tue 6 Oct", () => {
    const r = makePersonalRecord({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120, previousValue: null, achievedAt: "2026-10-06T10:00:00.000Z", localDate: "2026-10-06" });
    expect(headlineText(groupByExercise([r])[0]!, "kg")).toBe("Most calories 120 cal · Tue 6 Oct");
  });
});
