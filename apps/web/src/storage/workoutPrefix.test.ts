import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUserData, isUserDataKey } from "./clearUserData";
import {
  blockUserDataWrites,
  localStorageAdapter,
  memoryStorageAdapter,
  resetUserDataWritesForTests,
  watchExternalWrites,
} from "./storage";

afterEach(() => {
  resetUserDataWritesForTests();
  clearUserData(localStorageAdapter());
});

const storageEvent = (key: string | null, newValue: string | null = "x") =>
  new StorageEvent("storage", { key, newValue, storageArea: window.localStorage });

describe("06.2 AC7 — the outbox key is user data", () => {
  it("logout clears sin:workout:outbox", () => {
    const storage = memoryStorageAdapter({ "sin:workout:outbox": "{}", other: "kept" });
    expect(isUserDataKey("sin:workout:outbox")).toBe(true);
    clearUserData(storage);
    expect(storage.get("sin:workout:outbox")).toBeNull();
    expect(storage.get("other")).toBe("kept");
  });

  it("the logout write block also blocks the outbox key", () => {
    const storage = localStorageAdapter();
    blockUserDataWrites();
    storage.set("sin:workout:outbox", "late");
    expect(storage.get("sin:workout:outbox")).toBeNull();
  });
});

describe("06.2 AC19 — watchExternalWrites", () => {
  it("fires for a storage event on the watched key only, and stops after unsubscribe", () => {
    const onWrite = vi.fn();
    const stop = watchExternalWrites("sin:workout:outbox", onWrite);
    window.dispatchEvent(storageEvent("sin:other"));
    window.dispatchEvent(storageEvent("sin:workout:outbox"));
    expect(onWrite).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(storageEvent("sin:workout:outbox", "y"));
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("a key cleared by another tab (key null: storage.clear()) also counts", () => {
    const onWrite = vi.fn();
    const stop = watchExternalWrites("sin:workout:outbox", onWrite);
    window.dispatchEvent(storageEvent(null, null));
    expect(onWrite).toHaveBeenCalledTimes(1);
    stop();
  });
});
