import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import type { OutboxOp } from "./ops";
import { createOutbox, LEGACY_OUTBOX_KEY, outboxKey } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const never = () => new Promise<never>(() => {});
const rest = () => ({ createSet: vi.fn(never), updateSet: vi.fn(never), deleteSet: vi.fn(never), setExerciseNote: vi.fn(never) });
const make = (storage: StorageAdapter, userId: string) => createOutbox({ storage, rest: rest(), userId, isOnline: () => false });
const op = (userId: string, key = KEY): OutboxOp => ({
  id: `op-${key.slice(-1)}`,
  workoutId: "w",
  workoutExerciseId: "we",
  userId,
  status: "queued",
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "create",
  target: { clientGeneratedId: key },
  body: { clientGeneratedId: key, reps: 5, isComplete: true },
});
const file = (userId: string, ops: OutboxOp[], idMap: Record<string, { setId: string; workoutId: string }> = {}) =>
  JSON.stringify({ v: 1, userId, ops, idMap });
const setBody = (key = KEY) => ({ clientGeneratedId: key, reps: 5, isComplete: true });

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.reportError.mockReset();
});

describe("06.7 AC8 — outbox storage is per account", () => {
  it("the keys", () => {
    expect(outboxKey("u1")).toBe("sin:workout:outbox:u1");
    expect(LEGACY_OUTBOX_KEY).toBe("sin:workout:outbox");
  });

  it("writes and reads the per-user key, and never the legacy one", () => {
    const storage = memoryStorageAdapter();
    make(storage, "u1").enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    expect(JSON.parse(storage.get(outboxKey("u1"))!).ops).toHaveLength(1);
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBeNull();
    expect(make(storage, "u1").getState().ops).toHaveLength(1);
  });

  it("an emptied outbox removes its per-user file", () => {
    const storage = memoryStorageAdapter();
    const outbox = make(storage, "u1");
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    outbox.dropWorkout("w");
    expect(storage.get(outboxKey("u1"))).toBeNull();
  });

  it("adopts a same-user legacy file: writes the per-user key, then removes the legacy key", () => {
    const legacy = file("u1", [op("u1")], { [KEY2]: { setId: "s2", workoutId: "w" } });
    const storage = memoryStorageAdapter({ [LEGACY_OUTBOX_KEY]: legacy });
    const outbox = make(storage, "u1");
    expect(outbox.getState().ops.map((o) => o.id)).toEqual(["op-1"]);
    expect(outbox.getState().idMap).toEqual({ [KEY2]: { setId: "s2", workoutId: "w" } });
    expect(JSON.parse(storage.get(outboxKey("u1"))!)).toEqual(JSON.parse(legacy));
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBeNull();
  });

  it("a failed write during adoption leaves the legacy key, and the ops still load", () => {
    const inner = memoryStorageAdapter({ [LEGACY_OUTBOX_KEY]: file("u1", [op("u1")]) });
    const storage: StorageAdapter = {
      ...inner,
      set: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    const outbox = make(storage, "u1");
    expect(outbox.getState().ops).toHaveLength(1);
    expect(inner.get(LEGACY_OUTBOX_KEY)).not.toBeNull();
    expect(inner.get(outboxKey("u1"))).toBeNull();
    expect(outbox.getState().durable).toBe(false);
  });

  it("leaves another user's legacy file alone", () => {
    const legacy = file("u2", [op("u2")]);
    const storage = memoryStorageAdapter({ [LEGACY_OUTBOX_KEY]: legacy });
    const outbox = make(storage, "u1");
    expect(outbox.getState().ops).toEqual([]);
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBe(legacy);
  });

  it("two users on one adapter never touch each other's file", () => {
    const storage = memoryStorageAdapter();
    const a = make(storage, "u1");
    a.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: setBody() });
    const before = storage.get(outboxKey("u1"));
    const b = make(storage, "u2");
    expect(b.getState().ops).toEqual([]);
    b.enqueueCreate({ workoutId: "w2", workoutExerciseId: "we", body: setBody(KEY2) });
    b.dropWorkout("w2");
    expect(storage.get(outboxKey("u1"))).toBe(before);
    expect(storage.get(outboxKey("u2"))).toBeNull();
  });

  it("the conflict watch is on the per-user key: another tab writing it sets conflict, another user's key or the legacy key does not", () => {
    const outbox = make(memoryStorageAdapter(), "u1");
    const stop = outbox.start();
    const write = (key: string) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "{}", storageArea: window.localStorage }));
    write(outboxKey("u2"));
    write(LEGACY_OUTBOX_KEY);
    expect(outbox.getState().conflict).toBe(false);
    write(outboxKey("u1"));
    expect(outbox.getState().conflict).toBe(true);
    stop();
  });

  it("Review Focus 4: an existing per-user file wins over a same-user legacy file, nothing merges, and the legacy file is left", () => {
    const legacy = file("u1", [op("u1", KEY2)]);
    const storage = memoryStorageAdapter({ [outboxKey("u1")]: file("u1", [op("u1", KEY)]), [LEGACY_OUTBOX_KEY]: legacy });
    const outbox = make(storage, "u1");
    expect(outbox.getState().ops.map((o) => o.id)).toEqual(["op-1"]);
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBe(legacy);
  });

  it("Review Focus 5: a corrupt per-user file drops that key only, never another user's file or the legacy one", () => {
    const other = file("u2", [op("u2")]);
    const legacy = file("u3", [op("u3")]);
    const storage = memoryStorageAdapter({ [outboxKey("u1")]: "{not json", [outboxKey("u2")]: other, [LEGACY_OUTBOX_KEY]: legacy });
    const outbox = make(storage, "u1");
    expect(outbox.getState().ops).toEqual([]);
    expect(storage.get(outboxKey("u1"))).toBeNull();
    expect(storage.get(outboxKey("u2"))).toBe(other);
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBe(legacy);
    expect(observability.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "workout-storage" });
  });

  it("a per-user file whose userId is someone else's loads nothing (a defensive check) and is left", () => {
    const stray = file("u2", [op("u2")]);
    const storage = memoryStorageAdapter({ [outboxKey("u1")]: stray });
    expect(make(storage, "u1").getState().ops).toEqual([]);
    expect(storage.get(outboxKey("u1"))).toBe(stray);
  });
});
