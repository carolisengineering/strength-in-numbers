import { describe, expect, it } from "vitest";
import { makeQueryClient } from "../../test/workoutHarness";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { HISTORY_KEYS } from "../history/queries";
import { PROGRESS_KEYS } from "../progress/queries";
import { applyDeletedCaches, applyEditedCaches, applyFinishedCaches } from "./cache";
import { RECORDS_KEYS } from "./queries";

const W = "40000000-0000-4000-8000-000000000001";
const OTHER = "40000000-0000-4000-8000-000000000002";
const EX = "40000000-0000-4000-8000-000000000003";

function seeded() {
  const qc = makeQueryClient();
  qc.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
  qc.setQueryData(RECORDS_KEYS.forWorkout(OTHER), []);
  qc.setQueryData(RECORDS_KEYS.forExercise(EX), []);
  qc.setQueryData(PROGRESS_KEYS.series("e", "3m"), { exerciseId: "e", points: [] });
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

describe("08.1 AC8 — finish and delete invalidate every progress series", () => {
  it("applyFinishedCaches (with or without newRecords) invalidates ['progress']", () => {
    for (const newRecords of [[makePersonalRecord({ workoutId: W })], null]) {
      const qc = seeded();
      applyFinishedCaches(qc, W, newRecords);
      expect(invalidated(qc, PROGRESS_KEYS.series("e", "3m"))).toBe(true);
    }
  });

  it("applyDeletedCaches invalidates ['progress']", () => {
    const qc = seeded();
    applyDeletedCaches(qc, W);
    expect(invalidated(qc, PROGRESS_KEYS.series("e", "3m"))).toBe(true);
  });
});

describe("18.0 AC22 — applyEditedCaches", () => {
  it("resets the history list, invalidates progress and every records family, and leaves the workout keys alone", () => {
    const qc = makeQueryClient();
    qc.setQueryData(["history", "list"], { pages: [{ items: [], next: null }], pageParams: [null] });
    qc.setQueryData(["progress", "ex-1", "3m"], { exerciseId: "ex-1", points: [] });
    qc.setQueryData(["records", "all"], []);
    qc.setQueryData(["records", { workoutId: "w" }], []);
    qc.setQueryData(["records", { exerciseId: "e" }], []);
    const detail = { id: "w" };
    const active = { id: "live" };
    qc.setQueryData(["workouts", "detail", "w"], detail);
    qc.setQueryData(["workouts", "active"], active);

    applyEditedCaches(qc);

    expect(qc.getQueryState(["history", "list"])?.data).toBeUndefined();
    for (const key of [["progress", "ex-1", "3m"], ["records", "all"], ["records", { workoutId: "w" }], ["records", { exerciseId: "e" }]]) {
      expect(invalidated(qc, key)).toBe(true);
    }
    expect(qc.getQueryData(["workouts", "detail", "w"])).toBe(detail);
    expect(invalidated(qc, ["workouts", "detail", "w"])).toBe(false);
    expect(qc.getQueryData(["workouts", "active"])).toBe(active);
    expect(invalidated(qc, ["workouts", "active"])).toBe(false);
  });
});
