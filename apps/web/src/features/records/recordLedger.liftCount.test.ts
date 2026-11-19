import { liftsWithBeatenRecords, RECORD_UNIT_BY_TYPE, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { buildRecordLedger } from "./recordLedger";

/**
 * Spec 07.6 AC7, the web half: the summary heading's count (`buildRecordLedger(...).counted`) against the rule History's
 * `recordCount` follows (`liftsWithBeatenRecords`). Each case is the rows that the same-named fixture in the API's
 * `history-lift-count.integration.test.ts` leaves on its counted workout (types, values, sources), as
 * `GET /v1/personal-records?workoutId=` serves them.
 */
const workout = makeWorkoutDetail({ exercises: [] });

const row = (lift: string, recordType: RecordType, value: number, previousValue: number | null, sourceExerciseId = lift): PersonalRecord =>
  makePersonalRecord({ exerciseId: lift, sourceExerciseId, recordType, value, previousValue, unit: RECORD_UNIT_BY_TYPE[recordType] });

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [bench, fork] = [id(1), id(2)];

/** A lift's three records on the counted workout: heaviest weight, est. 1-rep max, set volume (value, previous). */
const three = (lift: string, w: [number, number | null], e: [number, number | null], v: [number, number | null]) => [
  row(lift, "heaviest_weight", ...w),
  row(lift, "best_est_1rm", ...e),
  row(lift, "best_set_volume", ...v),
];

const AGREEING: [name: string, records: PersonalRecord[], lifts: number][] = [
  // 100 × 5, then 102.5 × 5.
  ["weight-and-estimate-one-lift", three(bench, [102.5, 100], [119.583, 116.667], [512.5, 500]), 1],
  // 100 × 5, the first time.
  ["first-only-lift", three(bench, [100, null], [116.667, null], [500, null]), 0],
  // 60 × 15 (no estimate above 12 reps, and the volume stays there), then 62.5 × 5.
  ["mixed-lift", [row(bench, "heaviest_weight", 62.5, 60), row(bench, "best_est_1rm", 72.917, null)], 1],
  // 100 × 5, then 80 × 10.
  ["volume-only", [row(bench, "best_set_volume", 800, 500)], 0],
  // 100 × 5, then the origin 110 × 3 beside the copy 100 × 10: one root, two source exercises.
  ["fork-and-origin", [row(bench, "heaviest_weight", 110, 100), row(bench, "best_est_1rm", 133.333, 116.667, fork), row(bench, "best_set_volume", 1000, 500, fork)], 1],
  // Seven lifts at 50 × 5, then 52.5 × 5.
  ["seven-lifts", Array.from({ length: 7 }, (_, i) => three(id(10 + i), [52.5, 50], [61.25, 58.333], [262.5, 250])).flat(), 7],
];

/** D9: every beaten non-volume row rose by less than the lifter's unit shows, so the summary counts the lift 0. */
const VALUE_ONLY: [name: string, records: PersonalRecord[], pref: UnitPreference][] = [
  // 100 × 5, then 97.25 × 6: the weight stays with the first workout; both estimates read 116.5 kg.
  ["lone-rounded-zero-e1rm", [row(bench, "best_est_1rm", 116.7, 116.667), row(bench, "best_set_volume", 583.5, 500)], "kg"],
  // 100 kg × 5, then 220.5 lb × 5 (stored 100.017 kg): every figure reads the same in lb.
  ["lb-equal-weights", three(bench, [100.017, 100], [116.687, 116.667], [500.085, 500]), "lb"],
];

describe("07.6 AC7 — the summary heading counts what History counts, but for a gain that rounds away", () => {
  it.each(AGREEING)("%s: the ledger counts what liftsWithBeatenRecords counts", (_name, records, lifts) => {
    for (const pref of ["kg", "lb"] as const) {
      const counted = buildRecordLedger({ records, workout, pref, section: "workouts" }).counted;
      expect(counted).toBe(liftsWithBeatenRecords(records));
      expect(counted).toBe(lifts);
    }
  });

  it.each(VALUE_ONLY)("%s: History counts the lift, the summary doesn't (D9)", (_name, records, pref) => {
    expect(liftsWithBeatenRecords(records)).toBe(1);
    expect(buildRecordLedger({ records, workout, pref, section: "workouts" }).counted).toBe(0);
  });

  it("every beaten row in the fixtures is a real rise (07.0 D16, the invariant 07.6 D4 relies on)", () => {
    for (const records of [...AGREEING.map(([, r]) => r), ...VALUE_ONLY.map(([, r]) => r)]) {
      for (const r of records) if (r.previousValue !== null) expect(r.value).toBeGreaterThan(r.previousValue);
    }
  });
});
