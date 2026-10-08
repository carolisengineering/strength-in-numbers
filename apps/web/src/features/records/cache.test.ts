import { describe, expect, it } from "vitest";
import { makeQueryClient } from "../../test/workoutHarness";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { HISTORY_KEYS } from "../history/queries";
import { applyDeletedCaches, applyFinishedCaches } from "./cache";
import { RECORDS_KEYS } from "./queries";

const W = "40000000-0000-4000-8000-000000000001";
const OTHER = "40000000-0000-4000-8000-000000000002";
const EX = "40000000-0000-4000-8000-000000000003";

function seeded() {
  const qc = makeQueryClient();
  qc.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
  qc.setQueryData(RECORDS_KEYS.forWorkout(OTHER), []);
  qc.setQueryData(RECORDS_KEYS.forExercise(EX), []);
  return qc;
}
const invalidated = (qc: ReturnType<typeof makeQueryClient>, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;

describe("08.0 AC6 — applyFinishedCaches with newRecords", () => {
  it("seeds the workout's entry and invalidates history and every other records query", () => {
    const qc = seeded();
    const record = makePersonalRecord({ workoutId: W });

    applyFinishedCaches(qc, W, [record]);

    expect(qc.getQueryData(RECORDS_KEYS.forWorkout(W))).toEqual([record]);
    expect(invalidated(qc, RECORDS_KEYS.forWorkout(W))).toBe(false);
    expect(invalidated(qc, HISTORY_KEYS.list)).toBe(true);
    expect(invalidated(qc, RECORDS_KEYS.forWorkout(OTHER))).toBe(true);
    expect(invalidated(qc, RECORDS_KEYS.forExercise(EX))).toBe(true);
  });
});

describe("08.0 AC7 — applyFinishedCaches without newRecords (the recovery path)", () => {
  it("removes the workout's entry so the summary fetches it, and invalidates the rest", () => {
    const qc = seeded();
    qc.setQueryData(RECORDS_KEYS.forWorkout(W), [makePersonalRecord({ workoutId: W })]);

    applyFinishedCaches(qc, W, null);

    expect(qc.getQueryState(RECORDS_KEYS.forWorkout(W))).toBeUndefined();
    expect(invalidated(qc, HISTORY_KEYS.list)).toBe(true);
    expect(invalidated(qc, RECORDS_KEYS.forWorkout(OTHER))).toBe(true);
  });
});

describe("08.0 AC8 — applyDeletedCaches", () => {
  it("removes the workout's entry and invalidates history and records", () => {
    const qc = seeded();
    qc.setQueryData(RECORDS_KEYS.forWorkout(W), []);

    applyDeletedCaches(qc, W);

    expect(qc.getQueryState(RECORDS_KEYS.forWorkout(W))).toBeUndefined();
    expect(invalidated(qc, HISTORY_KEYS.list)).toBe(true);
    expect(invalidated(qc, RECORDS_KEYS.forExercise(EX))).toBe(true);
  });
});
