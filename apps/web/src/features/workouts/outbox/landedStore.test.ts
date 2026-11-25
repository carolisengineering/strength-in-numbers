import { describe, expect, it, vi } from "vitest";
import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import { USER_DATA_KEY_PREFIXES } from "../../../storage/clearUserData";
import { createLandedStore, LANDED_KEY, LANDED_MAX } from "./landedStore";

const item = (workoutId: string, lifts: number | null = 1, how: "landed" | "ours" | "elsewhere" = "landed") => ({ workoutId, lifts, how });

function setup(storage: StorageAdapter = memoryStorageAdapter(), userId = "u1") {
  const report = vi.fn();
  return { storage, report, store: createLandedStore({ storage, userId, report }) };
}

describe("06.7 AC27 — the landed store (sin:workout:landed)", () => {
  it("lives under the sin:workout: prefix, so every sign-out clears it", () => {
    expect(LANDED_KEY).toBe("sin:workout:landed");
    expect(USER_DATA_KEY_PREFIXES.some((p) => LANDED_KEY.startsWith(p))).toBe(true);
  });

  it("adds newest first, at most 5, in the §4 file shape", () => {
    const { store, storage } = setup();
    for (let i = 1; i <= 7; i += 1) store.add(item(`w${i}`, i));
    expect(LANDED_MAX).toBe(5);
    expect(store.list().map((x) => x.workoutId)).toEqual(["w7", "w6", "w5", "w4", "w3"]);
    expect(JSON.parse(storage.get(LANDED_KEY)!)).toEqual({
      v: 1,
      userId: "u1",
      items: [item("w7", 7), item("w6", 6), item("w5", 5), item("w4", 4), item("w3", 3)],
    });
  });

  it("a second landing of the same workout replaces its entry", () => {
    const { store } = setup();
    store.add(item("w1", 2));
    store.add(item("w2"));
    store.add(item("w1", null, "ours"));
    expect(store.list()).toEqual([item("w1", null, "ours"), item("w2")]);
  });

  it("remove and clearWorkout take one entry away; the last one takes the key", () => {
    const { store, storage } = setup();
    store.add(item("w1"));
    store.add(item("w2"));
    store.remove("w1");
    expect(store.list()).toEqual([item("w2")]);
    store.clearWorkout("w2");
    expect(store.list()).toEqual([]);
    expect(storage.get(LANDED_KEY)).toBeNull();
    expect(() => store.remove("missing")).not.toThrow();
  });

  it("survives a reload: a new store reads the same file", () => {
    const storage = memoryStorageAdapter();
    setup(storage).store.add(item("w1", 3));
    expect(setup(storage).store.list()).toEqual([item("w1", 3)]);
  });

  it("Review Focus 5: another user's file is ignored and cleared, never shown", () => {
    const storage = memoryStorageAdapter();
    setup(storage, "someone-else").store.add(item("theirs"));
    const mine = setup(storage, "u1");
    expect(mine.store.list()).toEqual([]);
    expect(storage.get(LANDED_KEY)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["the wrong version", JSON.stringify({ v: 2, userId: "u1", items: [] })],
    ["a bad item", JSON.stringify({ v: 1, userId: "u1", items: [{ workoutId: "w", lifts: "two", how: "landed" }] })],
    ["an unknown how", JSON.stringify({ v: 1, userId: "u1", items: [{ workoutId: "w", lifts: 1, how: "maybe" }] })],
  ])("a file that doesn't parse (%s) gives an empty list and clears the key", (_name, raw) => {
    const storage = memoryStorageAdapter();
    storage.set(LANDED_KEY, raw);
    expect(setup(storage).store.list()).toEqual([]);
    expect(storage.get(LANDED_KEY)).toBeNull();
  });

  it("a storage failure is reported once with the workout-storage source, and never throws", () => {
    const base = memoryStorageAdapter();
    const broken: StorageAdapter = {
      ...base,
      get: () => {
        throw new Error("SecurityError");
      },
      set: () => {
        throw new Error("QuotaExceededError");
      },
      remove: () => {
        throw new Error("SecurityError");
      },
    };
    const { store, report } = setup(broken);
    expect(() => store.add(item("w1"))).not.toThrow();
    expect(() => store.list()).not.toThrow();
    expect(() => store.remove("w1")).not.toThrow();
    store.add(item("w2"));
    expect(report).toHaveBeenCalledOnce();
  });

  it("subscribe tells a listener about each change, and stops when unsubscribed", () => {
    const { store } = setup();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.add(item("w1"));
    store.remove("w1");
    off();
    store.add(item("w2"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("minor 630 — the landed store and storage failures (Spec 06.7 §6.9, amended 2026-11-22)", () => {
  it("a second tab's entry survives: each write re-reads the file", () => {
    const storage = memoryStorageAdapter();
    const a = createLandedStore({ storage, userId: "u1", report: vi.fn() });
    const b = createLandedStore({ storage, userId: "u1", report: vi.fn() });
    a.add(item("w1"));
    b.add(item("w2"));
    const third = createLandedStore({ storage, userId: "u1", report: vi.fn() });
    expect(third.list().map((x) => x.workoutId)).toEqual(["w2", "w1"]);
  });

  it("a removal in one tab keeps the other tab's newer entry", () => {
    const storage = memoryStorageAdapter();
    const a = createLandedStore({ storage, userId: "u1", report: vi.fn() });
    a.add(item("w1"));
    const b = createLandedStore({ storage, userId: "u1", report: vi.fn() });
    b.add(item("w2"));
    a.remove("w1");
    expect(createLandedStore({ storage, userId: "u1", report: vi.fn() }).list().map((x) => x.workoutId)).toEqual(["w2"]);
  });

  it("minor 712: after a failed write, the next successful write keeps another tab's entry", () => {
    const inner = memoryStorageAdapter();
    let fail = true;
    const flaky: StorageAdapter = {
      ...inner,
      set: (key, value) => {
        if (fail) {
          fail = false;
          throw new Error("QuotaExceededError");
        }
        inner.set(key, value);
      },
    };
    const { store } = setup(flaky);
    store.add(item("w1")); // this write fails: w1 lives in this tab's memory
    const other = createLandedStore({ storage: inner, userId: "u1", report: vi.fn() });
    other.add(item("w2")); // another tab, once storage works again
    store.add(item("w3"));
    const file = JSON.parse(inner.get(LANDED_KEY)!) as { items: { workoutId: string }[] };
    expect(file.items.map((x) => x.workoutId).sort()).toEqual(["w1", "w2", "w3"]);
  });

  it("code review: a line removed while storage refused the write doesn't come back once storage works again", () => {
    const inner = memoryStorageAdapter();
    let refuse = false;
    const flaky: StorageAdapter = {
      ...inner,
      set: (key, value) => {
        if (refuse) throw new Error("QuotaExceededError");
        inner.set(key, value);
      },
      remove: (key) => {
        if (refuse) throw new Error("SecurityError");
        inner.remove(key);
      },
    };
    const { store } = setup(flaky);
    store.add(item("a"));
    store.add(item("b"));
    refuse = true;
    store.remove("a"); // the file still holds a
    refuse = false;
    store.add(item("c"));
    expect(store.list().map((x) => x.workoutId)).toEqual(["c", "b"]);
    const file = JSON.parse(inner.get(LANDED_KEY)!) as { items: { workoutId: string }[] };
    expect(file.items.map((x) => x.workoutId)).toEqual(["c", "b"]);
  });

  it("when storage can't be written, the line still shows for this page load", () => {
    const storage: StorageAdapter = {
      ...memoryStorageAdapter(),
      set: () => {
        throw new Error("quota");
      },
    };
    const { store, report } = setup(storage);
    store.add(item("w1"));
    store.add(item("w2"));
    expect(store.list().map((x) => x.workoutId)).toEqual(["w2", "w1"]);
    expect(report).toHaveBeenCalledOnce();
  });

  it("Review Focus 5: a read that fails during a write keeps the entries in memory", () => {
    const inner = memoryStorageAdapter();
    let reads = 0;
    const storage: StorageAdapter = {
      ...inner,
      get: (key) => {
        reads += 1;
        if (reads > 1) throw new Error("read failed");
        return inner.get(key);
      },
    };
    const { store } = setup(storage);
    store.add(item("w1"));
    store.add(item("w2"));
    expect(store.list().map((x) => x.workoutId)).toEqual(["w2", "w1"]);
  });
});
