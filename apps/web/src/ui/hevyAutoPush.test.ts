import { describe, expect, it } from "vitest";

import { clearUserData, isUserDataKey } from "../storage/clearUserData";
import { memoryStorageAdapter, type StorageAdapter } from "../storage/storage";
import { HEVY_AUTO_PUSH_KEY, isHevyAutoPushOn, setHevyAutoPush } from "./hevyAutoPush";

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

describe("20.2 AC23 — the auto-push preference", () => {
  it("is off by default", () => {
    expect(isHevyAutoPushOn(memoryStorageAdapter())).toBe(false);
  });

  it("on stores exactly \"on\" under sin:pref:hevy-auto-push; off removes the key", () => {
    const storage = memoryStorageAdapter();
    setHevyAutoPush(true, storage);
    expect(HEVY_AUTO_PUSH_KEY).toBe("sin:pref:hevy-auto-push");
    expect(storage.get(HEVY_AUTO_PUSH_KEY)).toBe("on");
    expect(isHevyAutoPushOn(storage)).toBe(true);
    setHevyAutoPush(false, storage);
    expect(storage.get(HEVY_AUTO_PUSH_KEY)).toBeNull();
    expect(isHevyAutoPushOn(storage)).toBe(false);
  });

  it.each(["yes", "true", "off", "ON", ""])("a stored %j reads off", (value) => {
    expect(isHevyAutoPushOn(memoryStorageAdapter({ [HEVY_AUTO_PUSH_KEY]: value }))).toBe(false);
  });

  it("unreadable storage reads off; a failed write does not throw", () => {
    expect(isHevyAutoPushOn(throwing)).toBe(false);
    expect(() => setHevyAutoPush(true, throwing)).not.toThrow();
    expect(() => setHevyAutoPush(false, throwing)).not.toThrow();
  });

  it("is a device preference: not user data, so logout keeps it", () => {
    expect(isUserDataKey(HEVY_AUTO_PUSH_KEY)).toBe(false);
    const storage = memoryStorageAdapter({ [HEVY_AUTO_PUSH_KEY]: "on" });
    clearUserData(storage);
    expect(storage.get(HEVY_AUTO_PUSH_KEY)).toBe("on");
  });
});
