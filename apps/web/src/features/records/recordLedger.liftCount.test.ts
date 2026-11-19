import { liftsWithBeatenRecords, RECORD_UNIT_BY_TYPE, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { buildRecordLedger } from "./recordLedger";

/**
 * Spec 07.6 AC7, the web half: the summary heading's count (`buildRecordLedger(...).counted`) against the rule History's
 * `recordCount` follows (`liftsWithBeatenRecords`), over the same fixtures as the API's
 * `history-lift-count.integration.test.ts`, written here as the rows `GET /v1/personal-records?workoutId=` serves.
 */
const workout = makeWorkoutDetail({ exercises: [] });

const row = (lift: string, recordType: RecordType, value: number, previousValue: number | null, sourceExerciseId = lift): PersonalRecord =>
  makePersonalRecord({ exerciseId: lift, sourceExerciseId, recordType, value, previousValue, unit: RECORD_UNIT_BY_TYPE[recordType] });

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [bench, fork] = [id(1), id(2)];

const AGREEING: [name: string, records: PersonalRecord[], lifts: number][] = [
  ["weight-and-estimate-one-lift", [row(bench, "heaviest_weight", 102.5, 100), row(bench, "best_est_1rm", 119.583, 116.667)], 1],
  ["first-only-lift", [row(bench, "heaviest_weight", 100, null), row(bench, "best_est_1rm", 116.667, null)], 0],
  ["mixed-lift", [row(bench, "heaviest_weight", 62.5, 60), row(bench, "best_est_1rm", 72.917, null)], 1],
  ["volume-only", [row(bench, "best_set_volume", 800, 500)], 0],
  // One root, two source exercises: the origin holds the weight, the copy the estimate.
  ["fork-and-origin", [row(bench, "heaviest_weight", 110, 100), row(bench, "best_est_1rm", 133.333, 116.667, fork)], 1],
  ["seven-lifts", Array.from({ length: 7 }, (_, i) => row(id(10 + i), "heaviest_weight", 52.5, 50)), 7],
];

/** D9: every beaten non-volume row rose by less than the lifter's unit shows, so the summary counts the lift 0. */
const VALUE_ONLY: [name: string, records: PersonalRecord[], pref: UnitPreference][] = [
  ["lone-rounded-zero-e1rm", [row(bench, "heaviest_weight", 100, null), row(bench, "best_est_1rm", 116.7, 116.667), row(bench, "best_set_volume", 583.5, 500)], "kg"],
  ["lb-equal-weights", [row(bench, "heaviest_weight", 100.017, 100), row(bench, "best_est_1rm", 116.686, 116.667), row(bench, "best_set_volume", 500.085, 500)], "lb"],
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
