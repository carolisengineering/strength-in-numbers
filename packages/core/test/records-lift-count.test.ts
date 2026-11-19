import { describe, expect, it } from "vitest";
import type { RecordType } from "../src/enums.js";
import type { ExerciseId } from "../src/ids.js";
import { liftsWithBeatenRecords } from "../src/records.js";

type Row = { exerciseId: ExerciseId; recordType: RecordType; previousValue: number | null };
const beaten = (id: string, recordType: RecordType = "heaviest_weight"): Row => ({ exerciseId: id as ExerciseId, recordType, previousValue: 100 });
const first = (id: string, recordType: RecordType = "heaviest_weight"): Row => ({ exerciseId: id as ExerciseId, recordType, previousValue: null });

describe("07.6 AC7 — liftsWithBeatenRecords, the lift count's one definition", () => {
  it("no records count 0", () => {
    expect(liftsWithBeatenRecords([])).toBe(0);
  });

  it("one lift that beat its weight and its estimate counts 1", () => {
    expect(liftsWithBeatenRecords([beaten("bench"), beaten("bench", "best_est_1rm")])).toBe(1);
  });

  it("three lifts that each beat two records count 3, not 6", () => {
    const rows = ["bench", "squat", "row"].flatMap((id) => [beaten(id), beaten(id, "best_est_1rm")]);
    expect(rows).toHaveLength(6);
    expect(liftsWithBeatenRecords(rows)).toBe(3);
  });

  it("first-ever records only count 0", () => {
    expect(liftsWithBeatenRecords([first("bench"), first("bench", "best_est_1rm"), first("squat")])).toBe(0);
  });

  it("a first-only lift beside a beaten lift adds nothing", () => {
    expect(liftsWithBeatenRecords([beaten("bench"), first("ohp"), first("ohp", "best_est_1rm")])).toBe(1);
  });

  it("a lift with a beaten row and a first row counts once", () => {
    expect(liftsWithBeatenRecords([beaten("bench"), first("bench", "best_est_1rm")])).toBe(1);
  });

  it("a beaten set volume alone counts 0", () => {
    expect(liftsWithBeatenRecords([beaten("bench", "best_set_volume")])).toBe(0);
  });

  it("a beaten set volume beside a beaten weight counts the lift once", () => {
    expect(liftsWithBeatenRecords([beaten("bench", "best_set_volume"), beaten("bench")])).toBe(1);
  });

  it("seven lifts with one beaten row each count 7", () => {
    expect(liftsWithBeatenRecords(["a", "b", "c", "d", "e", "f", "g"].map((id) => beaten(id)))).toBe(7);
  });

  it("every other record type counts when beaten", () => {
    const types: RecordType[] = ["heaviest_weight", "best_est_1rm", "max_reps", "max_calories", "max_distance", "max_duration"];
    expect(liftsWithBeatenRecords(types.map((t, i) => beaten(`lift-${i}`, t)))).toBe(types.length);
  });
});
