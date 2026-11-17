import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { UpdatedWorkout } from "@sin/core";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import type { FinishMeta } from "./ops";
import { createOutbox, type OutboxDeps } from "./outbox";

const ENDED = "2026-11-08T10:15:00.000Z";
const META: FinishMeta = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const updated = (): UpdatedWorkout => ({ ...makeWorkoutDetail({ endedAt: ENDED }), newRecords: [] }) as unknown as UpdatedWorkout;

function setup(over: Partial<OutboxDeps> = {}) {
  const calls: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const finish = vi.fn(() => new Promise<UpdatedWorkout>((resolve, reject) => calls.push({ resolve: resolve as (v: unknown) => void, reject })));
  const createSet = vi.fn(async () => ({}) as never);
  const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: fakeClient({ finish, createSet }), userId: "u1", isOnline: () => true, ...over });
  const stop = outbox.start();
  return { outbox, calls, finish, createSet, stop };
}

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC14 — a throw in the landing effects can't strand the tap or the queue (minor 626)", () => {
  it("the waiter still resolves landed (the cloud has it), the error is reported once with a static tag, and the queue goes on", async () => {
    const onFinishSynced = vi.fn(() => {
      throw new Error("landing broke");
    });
    const t = setup({ onFinishSynced });
    const opId = t.outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    const settled = t.outbox.whenFinishSettles(opId, 8000);
    await vi.advanceTimersByTimeAsync(0);
    t.calls[0]!.resolve(updated());
    await expect(settled).resolves.toBe("landed");
    expect(observability.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "workout-outbox" });
    // The queue goes on: another workout's set still sends.
    t.outbox.enqueueCreate({ workoutId: "w2", workoutExerciseId: "we", body: { clientGeneratedId: "30000000-0000-4000-8000-000000000001", reps: 5, isComplete: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.createSet).toHaveBeenCalledOnce();
    t.stop();
  });
});

describe("06.7 AC14 — a finish removed mid-send runs no landing (minor 629)", () => {
  it.each([
    ["dropWorkout", (t: ReturnType<typeof setup>) => t.outbox.dropWorkout("w")],
    ["discard", (t: ReturnType<typeof setup>) => t.outbox.discard(t.outbox.getState().ops[0]!.id)],
  ])("after %s, the PATCH's success calls no landing effects", async (_name, remove) => {
    const onFinishSynced = vi.fn();
    const t = setup({ onFinishSynced });
    t.outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    await vi.advanceTimersByTimeAsync(0);
    remove(t);
    t.calls[0]!.resolve(updated());
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinishSynced).not.toHaveBeenCalled();
    expect(t.outbox.getState().ops).toEqual([]);
    t.stop();
  });
});
