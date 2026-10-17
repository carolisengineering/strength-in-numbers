import { afterEach, describe, expect, it, vi } from "vitest";

import { isUserDataKey } from "../../storage/clearUserData";
import { blockUserDataWrites, localStorageAdapter, memoryStorageAdapter, resetUserDataWritesForTests, type StorageAdapter } from "../../storage/storage";
import { REST_KEY, clearWorkoutRest, createRestStore, createRestStores } from "./restStore";

const T = 1_760_000_000_000;
let t = T;
const now = () => t;
const base = { userId: "u1", workoutId: "w1", now };
const stored = (s: StorageAdapter) => JSON.parse(s.get(REST_KEY) ?? "null") as unknown;
const put = (s: StorageAdapter, value: unknown) => s.set(REST_KEY, JSON.stringify(value));
const file = (o: Record<string, unknown> = {}) => ({ v: 1, userId: "u1", workoutId: "w1", startedAt: T - 30_000, durationS: 120, ...o });

afterEach(() => {
  t = T;
  resetUserDataWritesForTests();
});

describe("17.1 AC46 — stored, validated and restored", () => {
  it("start writes { v, userId, workoutId, startedAt, durationS } at once and notifies", () => {
    const storage = memoryStorageAdapter();
    const store = createRestStore({ storage, ...base });
    const listener = vi.fn();
    store.subscribe(listener);
    store.start(90);
    expect(store.get()).toEqual({ startedAt: T, durationS: 90 });
    expect(stored(storage)).toEqual({ v: 1, userId: "u1", workoutId: "w1", startedAt: T, durationS: 90 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a later start replaces the timer with a fresh startedAt (AC42)", () => {
    const store = createRestStore({ storage: memoryStorageAdapter(), ...base });
    store.start(90);
    t += 10_000;
    store.start(60);
    expect(store.get()).toEqual({ startedAt: T + 10_000, durationS: 60 });
  });

  it("clear removes the key and notifies; clearing nothing is silent", () => {
    const storage = memoryStorageAdapter();
    const store = createRestStore({ storage, ...base });
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear();
    expect(listener).not.toHaveBeenCalled();
    store.start(90);
    store.clear();
    expect(store.get()).toBeNull();
    expect(storage.get(REST_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("restores a running timer for the same user and workout (Review Focus 4)", () => {
    const storage = memoryStorageAdapter();
    put(storage, file());
    expect(createRestStore({ storage, ...base }).get()).toEqual({ startedAt: T - 30_000, durationS: 120 });
  });

  it.each([
    ["unparsable JSON", "{"],
    ["a wrong version", JSON.stringify(file({ v: 2 }))],
    ["another user", JSON.stringify(file({ userId: "u2" }))],
    ["another workout", JSON.stringify(file({ workoutId: "w2" }))],
    ["a non-number start", JSON.stringify(file({ startedAt: "soon" }))],
    ["a null start (Infinity once serialized)", JSON.stringify(file({ startedAt: null }))],
    ["durationS 0", JSON.stringify(file({ durationS: 0 }))],
    ["durationS 901", JSON.stringify(file({ durationS: 901 }))],
    ["a fractional duration", JSON.stringify(file({ durationS: 1.5 }))],
    ["a start more than 5 s ahead (clock changed)", JSON.stringify(file({ startedAt: T + 5001 }))],
    ["an expired timer (no 'Ready' after a reload)", JSON.stringify(file({ startedAt: T - 120_000 }))],
  ])("drops %s and removes the key", (_label, raw) => {
    const storage = memoryStorageAdapter();
    storage.set(REST_KEY, raw);
    expect(createRestStore({ storage, ...base }).get()).toBeNull();
    expect(storage.get(REST_KEY)).toBeNull();
  });

  it("keeps a start up to 5 s ahead", () => {
    const storage = memoryStorageAdapter();
    put(storage, file({ startedAt: T + 5000 }));
    expect(createRestStore({ storage, ...base }).get()).not.toBeNull();
  });

  it("a storage failure is reported once with a static source and the timer keeps working in memory", () => {
    const failing: StorageAdapter = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {
        throw new Error("quota");
      },
      remove: () => {
        throw new Error("denied");
      },
      keys: () => [],
    };
    const report = vi.fn();
    const store = createRestStore({ storage: failing, ...base, report });
    store.start(90);
    store.start(60);
    store.clear();
    expect(report).toHaveBeenCalledTimes(1);
    expect(store.get()).toBeNull();
    store.start(30);
    expect(store.get()).toEqual({ startedAt: T, durationS: 30 });
  });
});

describe("17.1 AC47 — it ends with the workout and the user", () => {
  it("the key is user data, so logout clears it, and no new prefix is needed (AC51)", () => {
    expect(isUserDataKey(REST_KEY)).toBe(true);
  });

  it("after logout's write block a start persists nothing", () => {
    const storage = localStorageAdapter();
    storage.remove(REST_KEY);
    blockUserDataWrites();
    createRestStore({ storage, ...base }).start(90);
    expect(storage.get(REST_KEY)).toBeNull();
  });

  it("stores: clearWorkout clears the cached store's timer, or the stored value of that workout only", () => {
    const storage = memoryStorageAdapter();
    const stores = createRestStores(storage, "u1", now);
    const store = stores.forWorkout("w1");
    expect(stores.forWorkout("w1")).toBe(store);
    store.start(90);
    stores.clearWorkout("w1");
    expect(store.get()).toBeNull();
    put(storage, file({ workoutId: "w9" }));
    stores.clearWorkout("w1");
    expect(storage.get(REST_KEY)).not.toBeNull();
    stores.clearWorkout("w9");
    expect(storage.get(REST_KEY)).toBeNull();
  });

  it("clearWorkoutRest ignores unreadable values", () => {
    const storage = memoryStorageAdapter();
    storage.set(REST_KEY, "{");
    expect(() => clearWorkoutRest(storage, "w1")).not.toThrow();
  });
});
