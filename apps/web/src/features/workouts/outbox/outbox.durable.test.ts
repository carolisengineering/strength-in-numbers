import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { UpdatedWorkout } from "@sin/core";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import { createOutbox, outboxKey } from "./outbox";

const META = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 3, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const ENDED = "2026-11-08T10:15:00.000Z";
const never = () => new Promise<never>(() => {});

/** Storage whose writes throw (quota, private mode); reads work. */
function refusingStorage(): StorageAdapter {
  const inner = memoryStorageAdapter();
  return {
    ...inner,
    set: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  };
}

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.reportError.mockReset();
});

describe("06.7 AC10 — the outbox knows whether saved on this phone is true", () => {
  const rest = () => ({ createSet: vi.fn(never), updateSet: vi.fn(never), deleteSet: vi.fn(never), setExerciseNote: vi.fn(never), finish: vi.fn(never), getById: vi.fn(never) });

  it("durable is true for an outbox that has never had to write, and after a write that worked", () => {
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: rest(), userId: "u1", isOnline: () => false });
    expect(outbox.getState().durable).toBe(true);
    outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    expect(outbox.getState().durable).toBe(true);
  });

  it("Review Focus 2: a write that throws during enqueueFinish keeps the op in memory, sends it, turns durable false, and never throws", async () => {
    const r = rest();
    let resolveFinish: (value: UpdatedWorkout) => void = () => {};
    r.finish = vi.fn(() => new Promise<UpdatedWorkout>((resolve) => (resolveFinish = resolve)));
    const onFinishSynced = vi.fn();
    const outbox = createOutbox({ storage: refusingStorage(), rest: r, userId: "u1", isOnline: () => true, onFinishSynced });
    outbox.start();
    const heard = vi.fn();
    outbox.subscribe(heard);
    let id = "";
    expect(() => {
      id = outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    }).not.toThrow();
    expect(outbox.getState().durable).toBe(false);
    expect(heard).toHaveBeenCalled();
    expect(outbox.getState().ops.map((o) => o.id)).toEqual([id]);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.finish).toHaveBeenCalledTimes(1);
    resolveFinish({ ...makeWorkoutDetail({ endedAt: ENDED }), newRecords: [] } as unknown as UpdatedWorkout);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinishSynced).toHaveBeenCalledTimes(1);
    expect(outbox.getState().ops).toEqual([]);
    expect(outbox.getState().durable).toBe(false);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError.mock.calls[0]![1]).toEqual({ source: "workout-storage" });
  });

  it("durable is false while conflict is true (another tab wrote the file)", () => {
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: rest(), userId: "u1", isOnline: () => false });
    const stop = outbox.start();
    window.dispatchEvent(new StorageEvent("storage", { key: outboxKey("u1"), newValue: "{}", storageArea: window.localStorage }));
    expect(outbox.getState().conflict).toBe(true);
    expect(outbox.getState().durable).toBe(false);
    stop();
  });

  it("getState() keeps returning the same object while nothing changes", () => {
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: rest(), userId: "u1", isOnline: () => false });
    const before = outbox.getState();
    expect(outbox.getState()).toBe(before);
  });
});
