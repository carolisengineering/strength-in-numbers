import { describe, expect, it, vi } from "vitest";
import { clearUserData, isUserDataKey } from "../../storage/clearUserData";
import { memoryStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { HEVY_KEY_SHAPE, createKeyStore, hevyKeyStorageKey } from "./keyStore";

const KEY = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";
const OTHER = "0b0b0b0b-1111-4222-8333-444455556666";

describe("20.0 AC2 — the remembered key", () => {
  it("is stored as { v: 1, key } under sin:hevy:key:<userId> and read back", () => {
    const storage = memoryStorageAdapter();
    const store = createKeyStore(storage);
    expect(store.set("u", KEY, { remember: true })).toEqual({ remembered: true });
    expect(storage.get("sin:hevy:key:u")).toBe(JSON.stringify({ v: 1, key: KEY }));
    expect(hevyKeyStorageKey("u")).toBe("sin:hevy:key:u");
    expect(createKeyStore(storage).get("u")).toBe(KEY);
  });

  it.each([["{}"], ["not json"], [JSON.stringify({ v: 2, key: KEY })], [JSON.stringify({ v: 1, key: "abc" })]])(
    "a stored value that fails the schema (%s) reads as null and is removed",
    (raw) => {
      const storage = memoryStorageAdapter();
      storage.set("sin:hevy:key:u", raw);
      expect(createKeyStore(storage).get("u")).toBeNull();
      expect(storage.get("sin:hevy:key:u")).toBeNull();
    },
  );

  it("is user data, so logout clears it", () => {
    const storage = memoryStorageAdapter();
    createKeyStore(storage).set("u", KEY, { remember: true });
    expect(isUserDataKey("sin:hevy:key:u")).toBe(true);
    clearUserData(storage);
    expect(storage.keys()).toEqual([]);
  });

  it("never returns another user's key", () => {
    const store = createKeyStore(memoryStorageAdapter());
    store.set("a", KEY, { remember: true });
    store.set("b", OTHER, { remember: false });
    expect(store.get("a")).toBe(KEY);
    expect(store.get("b")).toBe(OTHER);
    expect(store.get("c")).toBeNull();
  });
});

describe("20.0 AC3 — Don't remember", () => {
  it("keeps the key in memory only and removes an earlier stored one", () => {
    const storage = memoryStorageAdapter();
    const store = createKeyStore(storage);
    store.set("u", OTHER, { remember: true });
    expect(store.set("u", KEY, { remember: false })).toEqual({ remembered: false });
    expect(storage.get("sin:hevy:key:u")).toBeNull();
    expect(store.get("u")).toBe(KEY);
    expect(createKeyStore(storage).get("u")).toBeNull();
  });

  it("a remembered set after a memory set clears the memory copy", () => {
    const storage = memoryStorageAdapter();
    const store = createKeyStore(storage);
    store.set("u", OTHER, { remember: false });
    store.set("u", KEY, { remember: true });
    storage.remove("sin:hevy:key:u");
    expect(store.get("u")).toBeNull();
  });

  it("remove deletes both copies, and subscribers hear each set and remove once", () => {
    const storage = memoryStorageAdapter();
    const store = createKeyStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("u", KEY, { remember: true });
    store.set("v", OTHER, { remember: false });
    store.remove("u");
    store.remove("v");
    expect(store.get("u")).toBeNull();
    expect(store.get("v")).toBeNull();
    expect(storage.keys()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    store.set("u", KEY, { remember: true });
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe("20.0 AC3 — storage that throws falls back to memory", () => {
  it("set answers not remembered, get still returns the key, nothing throws", () => {
    const throwing: StorageAdapter = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {
        throw new Error("quota");
      },
      remove: () => {
        throw new Error("denied");
      },
      keys: () => {
        throw new Error("denied");
      },
    };
    const store = createKeyStore(throwing);
    expect(store.set("u", KEY, { remember: true })).toEqual({ remembered: false });
    expect(store.get("u")).toBe(KEY);
    expect(() => store.remove("u")).not.toThrow();
    expect(store.get("u")).toBeNull();
  });
});

describe("Minor 169 — a refused remembered write leaves no older key behind", () => {
  it("removes the stored copy when the new remembered write throws", () => {
    const storage = memoryStorageAdapter();
    createKeyStore(storage).set("u", KEY, { remember: true });
    const refusing: StorageAdapter = {
      get: (k) => storage.get(k),
      remove: (k) => storage.remove(k),
      keys: () => storage.keys(),
      set: () => {
        throw new Error("quota");
      },
    };
    expect(createKeyStore(refusing).set("u", OTHER, { remember: true })).toEqual({ remembered: false });
    expect(createKeyStore(storage).get("u")).toBeNull();
  });
});

describe("Minor 174 — the parsed key is cached, and another tab's change is heard", () => {
  it("reads storage once until a set or remove", () => {
    const storage = memoryStorageAdapter();
    storage.set("sin:hevy:key:u", JSON.stringify({ v: 1, key: KEY }));
    const get = vi.spyOn(storage, "get");
    const store = createKeyStore(storage);
    expect(store.get("u")).toBe(KEY);
    expect(store.get("u")).toBe(KEY);
    expect(get).toHaveBeenCalledTimes(1);
    store.remove("u");
    expect(store.get("u")).toBeNull();
    store.set("u", OTHER, { remember: true });
    expect(store.get("u")).toBe(OTHER);
  });

  it("a storage event for the key notifies and re-reads (Review Focus 1)", () => {
    const storage = memoryStorageAdapter();
    storage.set("sin:hevy:key:u", JSON.stringify({ v: 1, key: KEY }));
    const store = createKeyStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get("u")).toBe(KEY);
    storage.remove("sin:hevy:key:u"); // another tab removed it
    window.dispatchEvent(new StorageEvent("storage", { key: "sin:hevy:key:u" }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get("u")).toBeNull();
    unsubscribe();
  });
});

describe("Minor 166 — the key must be a version UUID (owner: Hevy keys are)", () => {
  it.each([["5ec7e7a1-0b5e-0c3d-9a8f-1234deadbeef"], ["5ec7e7a1-0b5e-4c3d-1a8f-1234deadbeef"]])(
    "%s is refused",
    (raw) => {
      expect(HEVY_KEY_SHAPE.safeParse(raw).success).toBe(false);
    },
  );

  it("a v4 key passes", () => {
    expect(HEVY_KEY_SHAPE.safeParse(KEY).success).toBe(true);
  });
});
