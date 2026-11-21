import { describe, expect, it } from "vitest";
import { failedRowCount, type CreateOp, type FinishOp, type NoteOp, type OutboxOp, type UpdateOp } from "./ops";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
let n = 0;
const base = () => ({
  id: `op-${++n}`,
  workoutId: "w",
  workoutExerciseId: "we",
  userId: "u",
  status: "failed" as const,
  attempted: true,
  attempts: 1,
  nextAttemptAt: 0,
  enqueuedAt: 0,
});
const create = (key: string): CreateOp => ({ ...base(), kind: "create", target: { clientGeneratedId: key }, body: { clientGeneratedId: key, weight: 60, weightUnit: "kg", reps: 8, isComplete: true } });
const update = (key: string): UpdateOp => ({ ...base(), kind: "update", target: { clientGeneratedId: key }, body: { reps: 9 } });
const note = (): NoteOp => ({ ...base(), kind: "note", body: { notes: "x" } });
const finish = (): FinishOp =>
  ({
    id: `op-${++n}`,
    workoutId: "w",
    userId: "u",
    status: "failed",
    attempted: true,
    attempts: 1,
    nextAttemptAt: 0,
    enqueuedAt: 0,
    kind: "finish",
    body: { endedAt: "2026-10-02T11:00:00.000Z" },
    meta: { startedAt: "2026-10-02T10:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  }) as FinishOp;

describe("06.7 AC21 — minor 642: the status line counts refused rows", () => {
  it("a set whose create and edit were both refused is one row", () => {
    expect(failedRowCount([create(KEY), update(KEY)], "w", {})).toBe(1);
  });

  it("Review Focus 4: that set, a second refused set and a refused note are three rows", () => {
    const ops: OutboxOp[] = [create(KEY), update(KEY), create(KEY2), note()];
    expect(failedRowCount(ops, "w", {})).toBe(3);
  });

  it("a refused finish op is not a row (it doesn't lock Finish)", () => {
    expect(failedRowCount([finish()], "w", {})).toBe(0);
  });

  it("another workout's refused rows don't count", () => {
    expect(failedRowCount([{ ...create(KEY), workoutId: "other" }], "w", {})).toBe(0);
  });
});
