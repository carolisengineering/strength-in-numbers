import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { storedKg } from "../../test/units";
import { buildRecordCards, recordsNewCount, visibleRecords } from "./recordCards";
import { shortRecordLabel } from "./labels";

const kgSet = (o: Record<string, unknown> = {}) => makeSet({ reps: 5, weight: 190, weightKg: 190, ...o });
function workoutOf(specs: ExerciseSpec[]) {
  return makeWorkoutDetail({ exercises: specs });
}
/** A record sourced from the workout's i-th exercise, its first set. */
function rec(w: ReturnType<typeof workoutOf>, i: number, o: Record<string, unknown> = {}) {
  const e = w.exercises[i]!;
  return makePersonalRecord({
    exerciseId: e.exerciseId,
    sourceExerciseId: e.exerciseId,
    exerciseName: e.exerciseNameSnapshot,
    sourceSetId: e.sets[0]?.id,
    workoutId: w.id,
    ...o,
  });
}
const bench = (sets = [kgSet()]): ExerciseSpec => ({ modality: "weight_reps", name: "Bench Press", sets });

describe("17.2 AC15 / AC16 / AC17 / AC20 / AC26 — one card per exercise, set volume hidden", () => {
  it("heaviest + est. 1RM + set volume on one exercise is one card with one chip and no volume", () => {
    const w = workoutOf([bench()]);
    const records = [
      rec(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: 185 }),
      rec(w, 0, { recordType: "best_est_1rm", value: 221.67, previousValue: 215, unit: "kg" }),
      rec(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" }),
    ];
    const cards = buildRecordCards({ records, workout: w, pref: "kg" });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: "Bench Press",
      setText: "190 kg × 5",
      lead: { label: "Heaviest weight", valueText: "190 kg", gainText: "+5 kg", wasText: "was 185 kg", first: false },
      chips: [{ type: "best_est_1rm", label: "Est. 1RM" }],
    });
    expect(recordsNewCount(records)).toBe(2);
  });

  it("a workout with only set-volume records has no cards and a count of 0", () => {
    const w = workoutOf([bench()]);
    const records = [rec(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" })];
    expect(visibleRecords(records)).toEqual([]);
    expect(buildRecordCards({ records, workout: w, pref: "kg" })).toEqual([]);
    expect(recordsNewCount(records)).toBe(0);
  });

  it("the lead is heaviest weight, else est. 1RM, else max reps", () => {
    const w = workoutOf([bench(), { modality: "bodyweight_reps", name: "Pull-up", sets: [makeSet({ reps: 12, weight: null, weightUnit: null, weightKg: null })] }]);
    const cards = buildRecordCards({
      records: [
        rec(w, 0, { recordType: "best_est_1rm", value: 221.67, previousValue: 200, unit: "kg" }),
        rec(w, 1, { recordType: "max_reps", value: 12, previousValue: 10, unit: "reps" }),
      ],
      workout: w,
      pref: "kg",
    });
    expect(cards.map((c) => c.lead.label)).toEqual(["Best est. 1RM", "Most reps"]);
    expect(cards[1]!.lead).toMatchObject({ valueText: "12 reps", gainText: "+2 reps", wasText: "was 10 reps" });
  });

  it("a one-rep gain reads +1 rep", () => {
    const w = workoutOf([{ modality: "bodyweight_reps", name: "Pull-up", sets: [makeSet({ reps: 11, weight: null, weightUnit: null, weightKg: null })] }]);
    const [card] = buildRecordCards({ records: [rec(w, 0, { recordType: "max_reps", value: 11, previousValue: 10, unit: "reps" })], workout: w, pref: "kg" });
    expect(card!.lead.gainText).toBe("+1 rep");
  });

  it("12 exercises give 12 cards, no cap", () => {
    const w = workoutOf(Array.from({ length: 12 }, (_, i) => ({ ...bench(), name: `Lift ${i}` })));
    const records = w.exercises.map((_, i) => rec(w, i, { recordType: "heaviest_weight", value: 190, previousValue: 185 }));
    expect(buildRecordCards({ records, workout: w, pref: "kg" })).toHaveLength(12);
  });
});

describe("17.2 AC19 — first records", () => {
  it("lead with no previous value: first, no gain, no was, still a card and still counted", () => {
    const w = workoutOf([bench()]);
    const records = [rec(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: null })];
    const [card] = buildRecordCards({ records, workout: w, pref: "kg" });
    expect(card!.lead).toMatchObject({ first: true, gainText: null, wasText: null, valueText: "190 kg" });
    expect(recordsNewCount(records)).toBe(1);
  });
});

describe("17.2 AC21 / AC22 / AC23 — e1RM rounding and the gain after it", () => {
  const e1 = (w: ReturnType<typeof workoutOf>, value: number, previousValue: number | null) => rec(w, 0, { recordType: "best_est_1rm", value, previousValue, unit: "kg" });
  it("a lone e1RM whose rounded gain is zero leads with the rounded value, no gain, no was", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [e1(w, 137.2, 137)], workout: w, pref: "kg" });
    expect(card!.lead).toMatchObject({ label: "Best est. 1RM", valueText: "137 kg", gainText: null, wasText: null, first: false });
  });
  it("with another record present a zero-gain e1RM is a chip, not the lead", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({
      records: [rec(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: 185 }), e1(w, 137.2, 137)],
      workout: w,
      pref: "kg",
    });
    expect(card!.lead.label).toBe("Heaviest weight");
    expect(card!.chips).toEqual([{ type: "best_est_1rm", label: "Est. 1RM" }]);
  });
  it("a rising e1RM shows the gain computed from the rounded values", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [e1(w, 138.2, 137)], workout: w, pref: "kg" });
    expect(card!.lead).toMatchObject({ valueText: "138 kg", gainText: "+1 kg", wasText: "was 137 kg" });
  });
  it("a first e1RM is eligible to lead", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [rec(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: 185 }), e1(w, 221, null)], workout: w, pref: "kg" });
    expect(card!.lead.label).toBe("Heaviest weight"); // heaviest still leads when present
    const [only] = buildRecordCards({ records: [e1(w, 221, null)], workout: w, pref: "kg" });
    expect(only!.lead).toMatchObject({ first: true, gainText: null, valueText: "221 kg" });
  });
  it("an lb account sees a 2.268 kg gain as +5 lb", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [rec(w, 0, { recordType: "heaviest_weight", value: storedKg(225), previousValue: storedKg(220) })], workout: w, pref: "lb" });
    expect(card!.lead).toMatchObject({ valueText: "225 lb", gainText: "+5 lb", wasText: "was 220 lb" });
  });
  it("a kg account sees +2.5 kg", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [rec(w, 0, { recordType: "heaviest_weight", value: 102.5, previousValue: 100 })], workout: w, pref: "kg" });
    expect(card!.lead.gainText).toBe("+2.5 kg");
  });
});

describe("17.2 AC18 / AC25 — the lead set, grouping and order", () => {
  it("setText is null when the source set is not in the workout", () => {
    const w = workoutOf([bench()]);
    const [card] = buildRecordCards({ records: [rec(w, 0, { recordType: "heaviest_weight", sourceSetId: "9f0e0b8e-0000-4000-8000-000000000999" })], workout: w, pref: "kg" });
    expect(card!.setText).toBeNull();
  });
  it("records sharing a lineage root form one card even from different source exercises", () => {
    const w = workoutOf([bench(), bench()]);
    const root = w.exercises[0]!.exerciseId;
    const cards = buildRecordCards({
      records: [
        rec(w, 0, { exerciseId: root, recordType: "heaviest_weight", value: 190, previousValue: 185 }),
        rec(w, 1, { exerciseId: root, recordType: "max_reps", value: 12, previousValue: 10, unit: "reps" }),
      ],
      workout: w,
      pref: "kg",
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.chips).toEqual([{ type: "max_reps", label: "Most reps" }]);
  });
  it("cards follow the workout's exercise order; an unmatched card goes last by name", () => {
    const w = workoutOf([{ ...bench(), name: "Zed" }, { ...bench(), name: "Alpha" }]);
    const orphanA = makePersonalRecord({ exerciseName: "Curl", recordType: "heaviest_weight", workoutId: w.id });
    const orphanB = makePersonalRecord({ exerciseName: "Aardvark Row", recordType: "heaviest_weight", workoutId: w.id });
    const cards = buildRecordCards({
      records: [orphanA, rec(w, 1, { recordType: "heaviest_weight" }), orphanB, rec(w, 0, { recordType: "heaviest_weight" })],
      workout: w,
      pref: "kg",
    });
    expect(cards.map((c) => c.name)).toEqual(["Zed", "Alpha", "Aardvark Row", "Curl"]);
  });
});

describe("17.2 AC20 — short chip names", () => {
  it("are Heaviest, Est. 1RM and Most reps", () => {
    expect([shortRecordLabel("heaviest_weight"), shortRecordLabel("best_est_1rm"), shortRecordLabel("max_reps")]).toEqual(["Heaviest", "Est. 1RM", "Most reps"]);
  });
});
