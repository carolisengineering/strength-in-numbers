import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { memoryStorageAdapter } from "../../storage/storage";
import { createOutbox, type TestableOutbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import type { FinishOp, OutboxOp } from "./outbox/ops";
import { useWaitingFinish } from "./useWaitingFinish";

const finish = (workoutId: string, status: FinishOp["status"]): FinishOp => ({
  id: `finish-${workoutId}-${status}`,
  workoutId,
  userId: "u1",
  status,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "finish",
  body: { endedAt: "2026-11-08T10:15:00.000Z" },
  meta: { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
});
const note = (workoutId: string): OutboxOp => ({
  id: "note",
  workoutId,
  workoutExerciseId: "we",
  userId: "u1",
  status: "queued",
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "note",
  body: { notes: "x" },
});

function setup(ops: OutboxOp[], workoutId?: string) {
  const outbox: TestableOutbox = createOutbox({ storage: memoryStorageAdapter(), rest: {} as never, userId: "u1", isOnline: () => false });
  outbox.__setForTests(ops);
  const wrapper = ({ children }: { children: ReactNode }) => <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
  return { outbox, ...renderHook(() => useWaitingFinish(workoutId), { wrapper }) };
}

describe("06.7 §6.11 — useWaitingFinish reads 'waiting' from the ops", () => {
  it("no finish op: nothing waits, nothing failed", () => {
    expect(setup([note("w1")], "w1").result.current).toEqual({ op: null, waiting: false, failed: false });
  });

  it.each(["queued", "sending"] as const)("a %s finish op is waiting", (status) => {
    const op = finish("w1", status);
    expect(setup([op], "w1").result.current).toEqual({ op, waiting: true, failed: false });
  });

  it("a failed finish op is refused, not waiting", () => {
    const op = finish("w1", "failed");
    expect(setup([op], "w1").result.current).toEqual({ op, waiting: false, failed: true });
  });

  it("another workout's op is not this workout's", () => {
    expect(setup([finish("w2", "queued")], "w1").result.current).toEqual({ op: null, waiting: false, failed: false });
  });

  it("with no workout id, any workout's finish op counts (the Workouts screen's card)", () => {
    const op = finish("w2", "sending");
    expect(setup([note("w1"), op]).result.current).toEqual({ op, waiting: true, failed: false });
  });

  it("re-renders when the outbox changes", () => {
    const t = setup([], "w1");
    const op = finish("w1", "queued");
    act(() => t.outbox.__setForTests([op]));
    expect(t.result.current.waiting).toBe(true);
    act(() => t.outbox.__setForTests([]));
    expect(t.result.current).toEqual({ op: null, waiting: false, failed: false });
  });

  it("is empty where no provider is mounted", () => {
    expect(renderHook(() => useWaitingFinish("w1")).result.current).toEqual({ op: null, waiting: false, failed: false });
  });
});
