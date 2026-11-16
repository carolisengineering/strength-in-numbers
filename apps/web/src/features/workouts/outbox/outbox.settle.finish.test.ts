import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../observability/track", () => ({ track: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: vi.fn() }));

import { memoryStorageAdapter } from "../../../storage/storage";
import type { FinishOp, OpFailure, OutboxOp } from "./ops";
import { createOutbox, OUTBOX_KEY } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const KEY3 = "30000000-0000-4000-8000-000000000003";
const FAILURE: OpFailure = { status: 422, type: "validation-error", requestId: null };
const never = () => new Promise<never>(() => {});
const rest = () => ({ createSet: vi.fn(never), updateSet: vi.fn(never), deleteSet: vi.fn(never), setExerciseNote: vi.fn(never) });
const common = (id: string, workoutId: string) => ({ id, workoutId, userId: "u1", status: "queued" as const, attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0 });
const create = (id: string, workoutId: string, key: string, over: Partial<OutboxOp> = {}): OutboxOp =>
  ({ ...common(id, workoutId), workoutExerciseId: "we", kind: "create", target: { clientGeneratedId: key }, body: { clientGeneratedId: key, reps: 5, isComplete: true }, ...over }) as OutboxOp;
const finish = (id: string, workoutId: string, over: Partial<FinishOp> = {}): FinishOp => ({
  ...common(id, workoutId),
  kind: "finish",
  body: { endedAt: "2026-11-08T10:15:00.000Z" },
  meta: { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  ...over,
});
const failed = <T extends OutboxOp>(op: T): T => ({ ...op, status: "failed", failure: FAILURE });

function withIdMap(idMap: Record<string, { setId: string; workoutId: string }>) {
  const storage = memoryStorageAdapter();
  storage.set(OUTBOX_KEY, JSON.stringify({ v: 1, userId: "u1", ops: [], idMap }));
  return createOutbox({ storage, rest: rest(), userId: "u1", isOnline: () => false });
}

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => vi.useRealTimers());

describe("06.7 AC7 — settle cannot lose a workout that has a finish op", () => {
  it.each(["queued", "sending", "failed"] as const)("keeps every op, in every status, of a workout with a %s finish op that is not the active one", (status) => {
    const outbox = withIdMap({});
    const f = status === "failed" ? failed(finish("f", "w1")) : finish("f", "w1", { status });
    const ops = [create("a", "w1", KEY), failed(create("b", "w1", KEY2)), { ...create("c", "w1", KEY3), status: "sending" } as OutboxOp, f];
    outbox.__setForTests(ops);
    outbox.settle("w2");
    expect(outbox.getState().ops.map((o) => o.id)).toEqual(["a", "b", "c", "f"]);
    outbox.settle(null);
    expect(outbox.getState().ops.map((o) => o.id)).toEqual(["a", "b", "c", "f"]);
  });

  it("keeps the id-map entries of a workout with a finish op, even ones no remaining op targets", () => {
    const outbox = withIdMap({ [KEY]: { setId: "s-1", workoutId: "w1" }, [KEY2]: { setId: "s-2", workoutId: "w3" } });
    outbox.__setForTests([finish("f", "w1")]);
    outbox.settle("w2");
    expect(Object.keys(outbox.getState().idMap)).toEqual([KEY]);
  });

  it("failed ops of a workout without a finish op still go, beside a finishing workout that keeps its own", () => {
    const outbox = withIdMap({});
    outbox.__setForTests([failed(create("x", "w3", KEY)), failed(create("y", "w1", KEY2)), finish("f", "w1")]);
    outbox.settle("w2");
    expect(outbox.getState().ops.map((o) => o.id)).toEqual(["y", "f"]);
  });

  it("dropWorkout still removes a finishing workout's ops and id-map entries", () => {
    const outbox = withIdMap({ [KEY]: { setId: "s-1", workoutId: "w1" } });
    outbox.__setForTests([failed(create("y", "w1", KEY2)), finish("f", "w1")]);
    outbox.dropWorkout("w1");
    expect(outbox.getState().ops).toEqual([]);
    expect(outbox.getState().idMap).toEqual({});
  });
});
