import { WorkoutSchema, type PersonalRecord } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { groupByExercise } from "../progress/exercises";
import { recordLabel, recordParts, recordRowLabel, sortRecords } from "./labels";
import { buildRecordLedger } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";
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
    expect(recordRowLabel(reps(32.5, 14), "kg")).toBe("Most reps at 32.5\u00a0kg");
    expect(recordRowLabel(reps(31.751, 14), "lb")).toBe("Most reps at 70\u00a0lb");
    expect(recordRowLabel(makePersonalRecord({ recordType: "heaviest_weight" }), "kg")).toBe("Heaviest weight");
  });

  it("recordParts reads 14 reps, was 12 reps, under the weight's label", () => {
    expect(recordParts(reps(12.5, 14, 12), "kg")).toEqual({ label: "Most reps at 12.5\u00a0kg", value: "14 reps", was: "12 reps", first: false });
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

// Phase C (07.5 AC35–AC38): the summary's ledger row. Each lift's records come from one set of that lift unless named.
const liftOf = (name: string, set = makeSet({ reps: 14, weight: 32.5 })) => ({ modality: "weight_reps" as const, name, sets: [set] });
const ledgerFor = (lifts: ReturnType<typeof liftOf>[], records: (w: ReturnType<typeof makeWorkoutDetail>) => PersonalRecord[], pref: "kg" | "lb" = "kg") => {
  const workout = makeWorkoutDetail({ exercises: lifts });
  return buildRecordLedger({ records: records(workout), workout, pref, section: "workouts" });
};
/** A record of the workout's i-th exercise, from its first set. */
const recOf = (w: ReturnType<typeof makeWorkoutDetail>, i: number, o: Partial<Record<keyof PersonalRecord, unknown>>) => {
  const e = w.exercises[i]!;
  return makePersonalRecord({ exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: e.exerciseNameSnapshot, sourceSetId: e.sets[0]!.id, workoutId: w.id, previousValue: null, ...o });
};
const repsAt = (atWeightKg: number, value: number, previousValue: number | null) => ({ recordType: "max_reps_at_weight", unit: "reps", atWeightKg, value, previousValue });
const heaviestOf = (value: number, previousValue: number | null) => ({ recordType: "heaviest_weight", unit: "kg", value, previousValue });
const estOf = (value: number, previousValue: number | null) => ({ recordType: "best_est_1rm", unit: "kg", value, previousValue });

describe("07.5 AC35 — the row", () => {
  it("a beaten reps record reads Most reps at 32.5 kg, 12 → 14 reps, +2 reps", () => {
    const l = ledgerFor([liftOf("Lateral Raise")], (w) => [recOf(w, 0, repsAt(32.5, 14, 12))]);
    expect(l.heading).toBe("New record");
    expect(l.lifts[0]!.rows).toEqual([expect.objectContaining({ label: "Most reps at 32.5\u00a0kg", oldText: "12", newText: "14 reps", gainText: "+2 reps" })]);
  });
  it("a lb account that logged 70 lb reads Most reps at 70 lb", () => {
    const l = ledgerFor([liftOf("Lateral Raise")], (w) => [recOf(w, 0, repsAt(31.751, 14, 12))], "lb");
    expect(l.lifts[0]!.rows[0]).toMatchObject({ label: "Most reps at 70\u00a0lb", newText: "14 reps", gainText: "+2 reps" });
  });
});

describe("07.5 AC36 — order", () => {
  const records = (w: ReturnType<typeof makeWorkoutDetail>) => [
    recOf(w, 0, repsAt(30, 10, 9)),
    recOf(w, 0, repsAt(32.5, 9, 8)),
    recOf(w, 0, estOf(42.5, 40)),
    recOf(w, 0, heaviestOf(32.5, 30)),
  ];
  it("a lift's rows run in type order, then the heavier weight first; est. and reps rows from one set both show", () => {
    const rows = ledgerFor([liftOf("Bench Press")], records).lifts[0]!.rows;
    expect(rows.map((r) => r.type)).toEqual(["heaviest_weight", "best_est_1rm", "max_reps_at_weight", "max_reps_at_weight"]);
    expect(rows.slice(2).map((r) => r.label)).toEqual(["Most reps at 32.5\u00a0kg", "Most reps at 30\u00a0kg"]);
  });
  it("the panel draws both weights' rows with no duplicate key", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = ledgerFor([liftOf("Bench Press")], records);
    render(<RecordLedgerPanel heading={l.heading!} lifts={l.lifts} />);
    expect(screen.getByText("Most reps at 32.5 kg")).toBeInTheDocument();
    expect(screen.getByText("Most reps at 30 kg")).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("07.5 AC37 — a first time at a weight shows nothing on the summary", () => {
  it("a beaten heaviest beside a first time at a weight: one row, no first line, one lift counted", () => {
    const l = ledgerFor([liftOf("Bench Press")], (w) => [recOf(w, 0, heaviestOf(32.5, 30)), recOf(w, 0, repsAt(32.5, 14, null))]);
    expect(l.lifts[0]!.rows.map((r) => r.type)).toEqual(["heaviest_weight"]);
    expect(l.firsts).toEqual([]);
    expect(l.heading).toBe("New record");
    expect(l.counted).toBe(1);
  });
  it("a lift whose only records are first-time reps rows: no panel, no lines", () => {
    const l = ledgerFor([liftOf("Lateral Raise")], (w) => [recOf(w, 0, repsAt(12.5, 14, null)), recOf(w, 0, repsAt(15, 8, null))]);
    expect(l).toMatchObject({ heading: null, counted: 0, lifts: [], firsts: [] });
  });
  it("a value-only lift beside a first time at a weight leaves no line for the reps", () => {
    const l = ledgerFor([liftOf("Bench Press")], (w) => [recOf(w, 0, estOf(94.1, 94)), recOf(w, 0, repsAt(32.5, 14, null))]);
    expect(l).toMatchObject({ heading: null, lifts: [], firsts: [] });
  });
  it("a first-ever lift's line leads with its other first-time record, never the reps", () => {
    const l = ledgerFor([liftOf("Bench Press", makeSet({ reps: 6, weight: 100 }))], (w) => [recOf(w, 0, repsAt(100, 6, null)), recOf(w, 0, estOf(120, null)), recOf(w, 0, heaviestOf(100, null))]);
    expect(l.firsts.map((f) => f.text)).toEqual(["First time logged: Bench Press 100 kg"]);
  });
  it("the seven-lift collapse with reps rows still counts lifts", async () => {
    const names = ["Bench Press", "Squat", "Deadlift", "Row", "Overhead Press", "Curl", "Lateral Raise"];
    const l = ledgerFor(names.map((n) => liftOf(n)), (w) => [
      ...names.map((_, i) => recOf(w, i, heaviestOf(32.5, 30))),
      recOf(w, 0, repsAt(32.5, 14, 12)),
      recOf(w, 3, repsAt(32.5, 9, 8)),
      recOf(w, 5, repsAt(32.5, 7, null)),
    ]);
    expect(l.heading).toBe("New records on 7 lifts");
    expect(l.lifts).toHaveLength(7);
    render(<RecordLedgerPanel heading={l.heading!} lifts={l.lifts} />);
    expect(screen.getByRole("button", { name: "Show all 7 lifts" })).toBeInTheDocument();
  });
});

describe("07.5 AC38 — the label wraps above the figure, never inside the weight", () => {
  it("a no-break space joins the weight and its unit, so a narrow label column breaks before the weight", () => {
    expect(recordRowLabel(reps(32.5, 14), "kg")).toBe("Most reps at 32.5 kg");
    expect(recordRowLabel(reps(31.751, 14), "lb")).toBe("Most reps at 70 lb");
  });
});

describe("07.5 AC38 — accessible", () => {
  it("the row is one sentence, and the panel is axe-clean", async () => {
    const l = ledgerFor([liftOf("Lateral Raise")], (w) => [recOf(w, 0, repsAt(32.5, 14, 12))]);
    expect(l.lifts[0]!.rows[0]!.spoken).toBe("Most reps at 32.5\u00a0kg: was 12 reps, now 14 reps, up 2 reps");
    const { container } = render(<RecordLedgerPanel heading={l.heading!} lifts={l.lifts} />);
    expect(screen.getByText("Most reps at 32.5 kg: was 12 reps, now 14 reps, up 2 reps").nextElementSibling).toHaveAttribute("aria-hidden", "true");
    await expectNoAxeViolations(container);
  });
});
