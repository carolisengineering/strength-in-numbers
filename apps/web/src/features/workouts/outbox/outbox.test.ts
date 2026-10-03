import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import type { OutboxOp } from "./ops";
import { createOutbox, OUTBOX_KEY, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const body = (key = KEY) => ({ clientGeneratedId: key, weight: 60, weightUnit: "kg" as const, reps: 8, isComplete: true });
// A REST stub that never settles, so no op leaves the queue through a send in these tests.
const parkedRest = () => ({
  createSet: vi.fn(() => new Promise<never>(() => {})),
  updateSet: vi.fn(() => new Promise<never>(() => {})),
  deleteSet: vi.fn(() => new Promise<never>(() => {})),
});
const counter = () => {
  let i = 0;
  return () => `op-${++i}`;
};
const make = (over: Partial<OutboxDeps> = {}) =>
  createOutbox({ storage: memoryStorageAdapter(), rest: parkedRest(), userId: "u1", isOnline: () => false, newId: counter(), ...over });
const failedAs = (op: OutboxOp): OutboxOp => ({ ...op, status: "failed", failure: { status: 409, type: "workout-finished", requestId: null } });

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-10-03T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.reportError.mockReset();
});

describe("06.2 AC2 — enqueue applies the combining rules", () => {
  it("create then update of the same set leaves one create; subscribers hear each change", () => {
    const outbox = make();
    const heard = vi.fn();
    outbox.subscribe(heard);
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 9 } });
    expect(outbox.getState().ops).toHaveLength(1);
    expect(outbox.getState().ops[0]).toMatchObject({
      kind: "create",
      userId: "u1",
      status: "queued",
      attempted: false,
      enqueuedAt: Date.now(),
      nextAttemptAt: Date.now(),
      body: { reps: 9 },
    });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("getState() returns the same object until something changes", () => {
    const outbox = make();
    const before = outbox.getState();
    expect(outbox.getState()).toBe(before);
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    expect(outbox.getState()).not.toBe(before);
  });
});

describe("06.2 AC7 — the outbox survives a reload", () => {
  it("a new store over the same storage restores ops; a 'sending' op comes back queued and attempted", () => {
    const storage = memoryStorageAdapter();
    make({ storage }).enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    const saved = JSON.parse(storage.get(OUTBOX_KEY)!);
    saved.ops[0].status = "sending";
    storage.set(OUTBOX_KEY, JSON.stringify(saved));

    const second = make({ storage });
    expect(second.getState().ops[0]).toMatchObject({ kind: "create", status: "queued", attempted: true, body: { reps: 8 } });
  });

  it("an empty queue removes the key", () => {
    const storage = memoryStorageAdapter();
    const outbox = make({ storage });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    outbox.discard(outbox.getState().ops[0]!.id);
    expect(storage.get(OUTBOX_KEY)).toBeNull();
  });

  it("a storage write failure reports once, keeps working in memory, never throws", () => {
    const storage: StorageAdapter = {
      ...memoryStorageAdapter(),
      set: () => {
        throw new Error("quota");
      },
    };
    const outbox = make({ storage });
    expect(() => {
      outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
      outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body(KEY2) });
    }).not.toThrow();
    expect(outbox.getState().ops).toHaveLength(2);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workout-storage" });
  });

  it("a storage read failure reports once and starts empty", () => {
    const storage: StorageAdapter = {
      ...memoryStorageAdapter(),
      get: () => {
        throw new Error("denied");
      },
    };
    expect(make({ storage }).getState().ops).toEqual([]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });

  it("an unreadable value is dropped and reported once, never thrown (Review Focus 5)", () => {
    const storage = memoryStorageAdapter({ [OUTBOX_KEY]: "{not json" });
    const outbox = make({ storage });
    expect(outbox.getState().ops).toEqual([]);
    expect(storage.get(OUTBOX_KEY)).toBeNull();
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });

  it("a well-formed value of the wrong shape is dropped too", () => {
    const storage = memoryStorageAdapter({ [OUTBOX_KEY]: JSON.stringify({ v: 1, userId: "u1", ops: [{ kind: "create" }], idMap: {} }) });
    expect(make({ storage }).getState().ops).toEqual([]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });
});

describe("06.2 AC8 — ops belong to one user", () => {
  it("ops saved by another user are discarded on load and never sent", async () => {
    const storage = memoryStorageAdapter();
    make({ storage, userId: "someone-else" }).enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    const rest = parkedRest();
    const mine = make({ storage, rest, isOnline: () => true });
    expect(mine.getState().ops).toEqual([]);
    const stop = mine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(rest.createSet).not.toHaveBeenCalled();
    stop();
  });

  it("a file whose ops claim this user under another user's file id is still dropped", () => {
    const storage = memoryStorageAdapter();
    make({ storage }).enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    const saved = JSON.parse(storage.get(OUTBOX_KEY)!);
    saved.userId = "someone-else";
    storage.set(OUTBOX_KEY, JSON.stringify(saved));
    expect(make({ storage }).getState().ops).toEqual([]);
  });
});

describe("06.2 — targetFor, discard, retainOnly", () => {
  it("targetFor names a set with a queued create by its key, any other id by id", () => {
    const outbox = make();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    expect(outbox.targetFor(KEY)).toEqual({ clientGeneratedId: KEY });
    expect(outbox.targetFor("40000000-0000-4000-8000-000000000001")).toEqual({ setId: "40000000-0000-4000-8000-000000000001" });
  });

  it("discard of a create also drops later ops for that set and tells onDiscarded", () => {
    const onDiscarded = vi.fn();
    const outbox = make({ onDiscarded });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    // Freeze the create so the update is appended rather than merged.
    const create = outbox.getState().ops[0]!;
    outbox.__setForTests([{ ...create, attempted: true }]);
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 1 } });
    outbox.discard(create.id);
    expect(outbox.getState().ops).toEqual([]);
    expect(onDiscarded.mock.calls[0]![0]).toHaveLength(2);
  });

  it("discarding a failed follow-up of a failed create discards the create and every follow-up (final review I2)", () => {
    const onDiscarded = vi.fn();
    const outbox = make({ onDiscarded });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    const create = outbox.getState().ops[0]!;
    outbox.__setForTests([{ ...create, attempted: true }]);
    outbox.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { clientGeneratedId: KEY }, body: { reps: 1 } });
    const [c, u] = outbox.getState().ops;
    outbox.__setForTests([failedAs(c!), failedAs(u!)]);
    outbox.discard(u!.id);
    expect(outbox.getState().ops).toEqual([]);
    expect(onDiscarded.mock.calls[0]![0].map((o: OutboxOp) => o.kind)).toEqual(["create", "update"]);
  });

  it("discard of an unknown op does nothing", () => {
    const onDiscarded = vi.fn();
    const outbox = make({ onDiscarded });
    outbox.discard("nope");
    expect(onDiscarded).not.toHaveBeenCalled();
  });

  it("retainOnly drops ops for every other workout", () => {
    const outbox = make();
    outbox.enqueueCreate({ workoutId: "w1", workoutExerciseId: "we", body: body() });
    outbox.enqueueCreate({ workoutId: "w2", workoutExerciseId: "we", body: body(KEY2) });
    outbox.retainOnly("w2");
    expect(outbox.getState().ops.map((o) => o.workoutId)).toEqual(["w2"]);
    outbox.retainOnly(null);
    expect(outbox.getState().ops).toEqual([]);
  });

  it("discardFailed removes only failed ops of that workout", () => {
    const onDiscarded = vi.fn();
    const outbox = make({ onDiscarded });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body(KEY2) });
    const [a, b] = outbox.getState().ops;
    outbox.__setForTests([failedAs(a!), b!]);
    outbox.discardFailed("w");
    expect(outbox.getState().ops.map((o) => o.id)).toEqual([b!.id]);
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    outbox.discardFailed("w");
    expect(onDiscarded).toHaveBeenCalledTimes(1);
  });
});
