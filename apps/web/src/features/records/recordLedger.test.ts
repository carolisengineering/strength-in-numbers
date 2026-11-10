import { RECORD_TYPE_VALUES } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { storedKg } from "../../test/units";
import { buildRecordLedger, collapsedCount, LEDGER_COLLAPSE_OVER, LEDGER_COLLAPSED_SHOWS, type LedgerSection } from "./recordLedger";

const kgSet = (o: Record<string, unknown> = {}) => makeSet({ reps: 5, weight: 190, weightKg: 190, ...o });
const workoutOf = (specs: ExerciseSpec[]) => makeWorkoutDetail({ exercises: specs });
type Workout = ReturnType<typeof workoutOf>;
/** A record sourced from the workout's i-th exercise, its j-th set (the first by default). */
function rec(w: Workout, i: number, o: Record<string, unknown> = {}, j = 0) {
  const e = w.exercises[i]!;
  return makePersonalRecord({ exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: e.exerciseNameSnapshot, sourceSetId: e.sets[j]?.id, workoutId: w.id, ...o });
}
const lift = (name: string, sets = [kgSet()], modality: ExerciseSpec["modality"] = "weight_reps"): ExerciseSpec => ({ modality, name, sets });
const ledger = (records: Parameters<typeof buildRecordLedger>[0]["records"], workout: Workout, o: { pref?: "kg" | "lb"; section?: LedgerSection } = {}) =>
  buildRecordLedger({ records, workout, pref: o.pref ?? "kg", section: o.section ?? "workouts" });
const heaviest = (value: number, previousValue: number | null) => ({ recordType: "heaviest_weight", value, previousValue, unit: "kg" });
const estimate = (value: number, previousValue: number | null) => ({ recordType: "best_est_1rm", value, previousValue, unit: "kg" });

describe("17.6 AC3 — the heading counts lifts", () => {
  it("three lifts", () => {
    const w = workoutOf([lift("Bench Press"), lift("Overhead Press"), lift("Row")]);
    expect(ledger([rec(w, 0, heaviest(190, 185)), rec(w, 1, heaviest(60, 57.5)), rec(w, 2, heaviest(80, 75))], w).heading).toBe("New records on 3 lifts");
  });
  it("one lift with two rows, and one row in all", () => {
    const w = workoutOf([lift("Bench Press")]);
    expect(ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(221.5, 215))], w).heading).toBe("New records on 1 lift");
    expect(ledger([rec(w, 0, heaviest(190, 185))], w).heading).toBe("New record");
  });
  it("a first-only lift beside one beaten row is not counted", () => {
    const w = workoutOf([lift("Bench Press"), lift("Triceps Pushdown")]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 1, heaviest(32.5, null))], w);
    expect(l.heading).toBe("New record");
    expect(l.lifts).toHaveLength(1);
    expect(l.firsts).toHaveLength(1);
  });
});

describe("17.6 AC6 / 17.2 AC22 — a zero-gain estimate", () => {
  it("is dropped beside a beaten heaviest row", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(215.1, 215))], w);
    expect(l.lifts[0]!.rows.map((r) => r.type)).toEqual(["heaviest_weight"]);
  });
  it("alone, it is one value-only row and the lift counts", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, estimate(94.1, 94))], w);
    expect(l.heading).toBe("New record");
    expect(l.lifts[0]!.rows).toEqual([expect.objectContaining({ type: "best_est_1rm", label: "Est. 1-rep max", newText: "94 kg", oldText: null, gainText: null })]);
  });
  it("beaten but unchanged beside a first heaviest: the same value-only row, and no first line", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(190, null)), rec(w, 0, estimate(94.1, 94))], w);
    expect(l.lifts[0]!.rows.map((r) => [r.type, r.gainText])).toEqual([["best_est_1rm", null]]);
    expect(l.firsts).toEqual([]);
  });
  it("Review Focus 3: a lb account where both weights read 220.5 lb gets one value-only row that still counts", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(100.017, 100))], w, { pref: "lb" });
    expect(l.heading).toBe("New record");
    expect(l.lifts[0]!.rows).toEqual([expect.objectContaining({ newText: "220.5 lb", oldText: null, gainText: null })]);
  });
});

describe("17.6 AC7 — row types", () => {
  it("rows come in RECORD_TYPE_VALUES order with their labels, set volume left out", () => {
    const w = workoutOf([lift("Carry")]);
    const records = [
      rec(w, 0, { recordType: "max_duration", value: 105, previousValue: 90, unit: "s" }),
      rec(w, 0, { recordType: "max_distance", value: 50, previousValue: 40, unit: "m" }),
      rec(w, 0, { recordType: "max_calories", value: 120, previousValue: 115, unit: "cal" }),
      rec(w, 0, { recordType: "max_reps", value: 6, previousValue: 5, unit: "reps" }),
      rec(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" }),
      rec(w, 0, estimate(221.5, 215)),
      rec(w, 0, heaviest(190, 185)),
    ];
    const rows = ledger(records, w).lifts[0]!.rows;
    expect(rows.map((r) => r.type)).toEqual(RECORD_TYPE_VALUES.filter((t) => t !== "best_set_volume"));
    expect(rows.map((r) => r.label)).toEqual(["Heaviest weight", "Est. 1-rep max", "Most reps", "Most calories", "Longest distance", "Longest hold"]);
    expect(rows[0]!.spoken).toBe("Heaviest weight: was 185 kg, now 190 kg, up 5 kg");
  });
});

describe("17.6 AC8 — where the set came from", () => {
  it("one shared set: one line on the lift, none on the rows", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(221.5, 215))], w);
    expect(l.lifts[0]!.sourceText).toBe("from your 190 kg × 5");
    expect(l.lifts[0]!.rows.map((r) => r.sourceText)).toEqual([null, null]);
  });
  it("different sets: each row its own line", () => {
    const w = workoutOf([lift("Bench Press", [kgSet(), kgSet({ setNumber: 2, weight: 180, weightKg: 180, reps: 8 })])]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(225, 215), 1)], w);
    expect(l.lifts[0]!.sourceText).toBeNull();
    expect(l.lifts[0]!.rows.map((r) => r.sourceText)).toEqual(["from your 190 kg × 5", "from your 180 kg × 8"]);
  });
  it("Review Focus 1: different sets with the estimate dropped: one row, and the lift's line is the heaviest set's", () => {
    const w = workoutOf([lift("Bench Press", [kgSet(), kgSet({ setNumber: 2, weight: 180, weightKg: 180, reps: 8 })])]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(215.1, 215), 1)], w);
    expect(l.lifts[0]!.rows).toHaveLength(1);
    expect(l.lifts[0]!.sourceText).toBe("from your 190 kg × 5");
    expect(l.lifts[0]!.rows[0]!.sourceText).toBeNull();
  });
  it("Review Focus 4: a set not in the workout gets no line", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, { ...heaviest(190, 185), sourceSetId: "99999999-0000-4000-8000-000000000009" })], w);
    expect(l.lifts[0]!.sourceText).toBeNull();
  });
  it("a carry's set reads as logged", () => {
    const w = workoutOf([lift("Farmer Carry", [makeSet({ reps: null, weight: 24, weightKg: 24, distance: 40, distanceUnit: "m", distanceM: 40 })], "weight_distance")]);
    const l = ledger([rec(w, 0, { recordType: "max_distance", value: 40, previousValue: 30, unit: "m" })], w);
    expect(l.lifts[0]!.sourceText).toBe("from your 24 kg · 40 m");
  });
});

describe("17.6 AC10 / 17.2 AC25 — order", () => {
  it("the workout's order, not name order; the same exercise twice takes its first position", () => {
    const w = workoutOf([lift("Zercher Squat"), lift("Bench Press"), lift("Zercher Squat")]);
    w.exercises[2] = { ...w.exercises[2]!, exerciseId: w.exercises[0]!.exerciseId };
    const l = ledger([rec(w, 1, heaviest(190, 185)), rec(w, 2, heaviest(140, 135))], w);
    expect(l.lifts.map((x) => x.name)).toEqual(["Zercher Squat", "Bench Press"]);
  });
  it("Review Focus 4: an unmatched exercise sorts after the matched ones, two unmatched by name, and nothing throws", () => {
    const w = workoutOf([lift("Row")]);
    const gone = (name: string) => makePersonalRecord({ exerciseName: name, ...heaviest(50, 45) });
    const l = ledger([gone("Zottman Curl"), rec(w, 0, heaviest(80, 75)), gone("Arnold Press")], w);
    expect(l.lifts.map((x) => x.name)).toEqual(["Row", "Arnold Press", "Zottman Curl"]);
    expect(l.lifts[2]!.sourceText).toBeNull();
  });
});

describe("17.6 AC10 — a lift is named by a row it shows", () => {
  it("when a hidden first record carries another snapshot name, the lift takes the shown row's name", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, { ...heaviest(190, null), exerciseName: "Bench Press" }), rec(w, 0, { ...estimate(225, 215), exerciseName: "Bench Press (paused)" })], w);
    expect(l.lifts[0]!.rows.map((r) => r.type)).toEqual(["best_est_1rm"]);
    expect(l.lifts[0]!.name).toBe("Bench Press (paused)");
  });
});

describe("17.6 AC12 — first times are quiet lines", () => {
  it("a first heaviest", () => {
    const w = workoutOf([lift("Triceps Pushdown")]);
    expect(ledger([rec(w, 0, heaviest(32.5, null))], w).firsts).toEqual([{ key: w.exercises[0]!.exerciseId, text: "First time logged: Triceps Pushdown 32.5 kg" }]);
  });
  it("an estimate lead says so", () => {
    const w = workoutOf([lift("Bench Press")]);
    expect(ledger([rec(w, 0, estimate(96.5, null))], w).firsts[0]!.text).toBe("First time logged: Bench Press, est. 1-rep max 96.5 kg");
  });
  it("heaviest and estimate both first: the heaviest leads", () => {
    const w = workoutOf([lift("Bench Press")]);
    expect(ledger([rec(w, 0, estimate(96.5, null)), rec(w, 0, heaviest(82.5, null))], w).firsts[0]!.text).toBe("First time logged: Bench Press 82.5 kg");
  });
  it("reps, a hold, and a lb account", () => {
    const w = workoutOf([lift("Pull-up"), lift("Plank"), lift("Squat")]);
    const l = ledger([rec(w, 0, { recordType: "max_reps", value: 12, previousValue: null, unit: "reps" }), rec(w, 1, { recordType: "max_duration", value: 90, previousValue: null, unit: "s" }), rec(w, 2, heaviest(storedKg(225), null))], w, { pref: "lb" });
    expect(l.firsts.map((f) => f.text)).toEqual(["First time logged: Pull-up 12 reps", "First time logged: Plank 1 min 30 s", "First time logged: Squat 225 lb"]);
  });
});

describe("17.6 AC13 — mixed lifts", () => {
  it("a beaten row beside a first row shows only the beaten row, and no first line", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(190, 185)), rec(w, 0, estimate(225, null))], w);
    expect(l.lifts[0]!.rows.map((r) => r.type)).toEqual(["heaviest_weight"]);
    expect(l.firsts).toEqual([]);
  });
  it("first lines follow the workout's order", () => {
    const w = workoutOf([lift("Zercher Squat"), lift("Bench Press")]);
    expect(ledger([rec(w, 1, heaviest(80, null)), rec(w, 0, heaviest(100, null))], w).firsts.map((f) => f.text)).toEqual(["First time logged: Zercher Squat 100 kg", "First time logged: Bench Press 80 kg"]);
  });
  it("no beaten record at all: no heading and no lifts", () => {
    const w = workoutOf([lift("Bench Press")]);
    const l = ledger([rec(w, 0, heaviest(80, null))], w);
    expect(l.heading).toBeNull();
    expect(l.lifts).toEqual([]);
  });
});

describe("17.6 AC14 / 17.2 AC16 / 17.2 AC24 — no set volume or timed rows", () => {
  it("set volume only, or no records, is an empty ledger", () => {
    const w = workoutOf([lift("Bench Press")]);
    const empty = { heading: null, lifts: [], firsts: [] };
    expect(ledger([rec(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" })], w)).toEqual(empty);
    expect(ledger([], w)).toEqual(empty);
  });
});

describe("17.6 AC15 — the section picks the wording", () => {
  it("History says Records from this workout; rows and first lines are identical", () => {
    const w = workoutOf([lift("Bench Press"), lift("Overhead Press"), lift("Row"), lift("Curl")]);
    const records = [rec(w, 0, heaviest(190, 185)), rec(w, 1, heaviest(60, 57.5)), rec(w, 2, heaviest(80, 75)), rec(w, 3, heaviest(20, null))];
    const live = ledger(records, w);
    const history = ledger(records, w, { section: "history" });
    expect(history.heading).toBe("Records from this workout on 3 lifts");
    expect(history.lifts).toEqual(live.lifts);
    expect(history.firsts).toEqual(live.firsts);
    expect(ledger([records[0]!, rec(w, 0, estimate(221.5, 215))], w, { section: "history" }).heading).toBe("Records from this workout on 1 lift");
    expect(ledger([records[0]!], w, { section: "history" }).heading).toBe("Record from this workout");
  });
});

describe("17.6 AC11 — the collapse rule", () => {
  it("more than 4 shows 3 until expanded", () => {
    expect([LEDGER_COLLAPSE_OVER, LEDGER_COLLAPSED_SHOWS]).toEqual([4, 3]);
    expect(collapsedCount(4, false)).toBe(4);
    expect(collapsedCount(5, false)).toBe(3);
    expect(collapsedCount(7, true)).toBe(7);
    expect(collapsedCount(0, false)).toBe(0);
  });
});
