import { describe, expect, it } from "vitest";

import { clearUserData, isUserDataKey } from "../storage/clearUserData";
import { memoryStorageAdapter, type StorageAdapter } from "../storage/storage";
import { KEEP_AWAKE_KEY, readKeepAwake, setKeepAwake } from "./keepAwake";

const throwing: StorageAdapter = {
  get: () => {
    throw new Error("blocked");
  },
  set: () => {
    throw new Error("blocked");
  },
  remove: () => {
    throw new Error("blocked");
  },
  keys: () => {
    throw new Error("blocked");
  },
};

describe("#108 — the keep-awake preference", () => {
  it("is on by default", () => {
    expect(readKeepAwake(memoryStorageAdapter())).toBe(true);
  });

  it("off is stored; on removes the key", () => {
    const storage = memoryStorageAdapter();
    setKeepAwake(false, storage);
    expect(storage.get(KEEP_AWAKE_KEY)).toBe("off");
    expect(readKeepAwake(storage)).toBe(false);
    setKeepAwake(true, storage);
    expect(storage.get(KEEP_AWAKE_KEY)).toBeNull();
    expect(readKeepAwake(storage)).toBe(true);
  });

  it("an unknown stored value, or unreadable storage, means on; a failed write does not throw", () => {
    expect(readKeepAwake(memoryStorageAdapter({ [KEEP_AWAKE_KEY]: "maybe" }))).toBe(true);
    expect(readKeepAwake(throwing)).toBe(true);
    expect(() => setKeepAwake(false, throwing)).not.toThrow();
  });

  it("is a device preference: logout keeps it", () => {
    expect(KEEP_AWAKE_KEY.startsWith("sin:pref:")).toBe(true);
    expect(isUserDataKey(KEEP_AWAKE_KEY)).toBe(false);
    const storage = memoryStorageAdapter({ [KEEP_AWAKE_KEY]: "off" });
    clearUserData(storage);
    expect(storage.get(KEEP_AWAKE_KEY)).toBe("off");
  });
});
