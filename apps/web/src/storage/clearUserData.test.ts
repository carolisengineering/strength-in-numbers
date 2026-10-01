import { describe, expect, it } from "vitest";

import { clearUserData, isUserDataKey } from "./clearUserData";
import { memoryStorageAdapter, type StorageAdapter } from "./storage";

describe("AC20 — clearUserData removes every user-scoped key", () => {
  it("removes sin:catalog:* and sin:recents:* for every user and nothing else", () => {
    const storage = memoryStorageAdapter({
      "sin:catalog:v1:user-a": "{}",
      "sin:recents:v1:user-a": "{}",
      "sin:catalog:v1:user-b": "{}",
      "sin:recents:v0:user-b": "{}",
      theme: "dark",
      "sin:other": "keep",
    });

    clearUserData(storage);

    expect(storage.keys().sort()).toEqual(["sin:other", "theme"]);
  });

  it("never throws when the adapter throws", () => {
    const throwing: StorageAdapter = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {
        throw new Error("denied");
      },
      remove: () => {
        throw new Error("denied");
      },
      keys: () => {
        throw new Error("denied");
      },
    };

    expect(() => clearUserData(throwing)).not.toThrow();
  });

  it("isUserDataKey matches only the listed prefixes", () => {
    expect(isUserDataKey("sin:catalog:v1:u")).toBe(true);
    expect(isUserDataKey("sin:recents:v1:u")).toBe(true);
    expect(isUserDataKey("sin:other")).toBe(false);
    expect(isUserDataKey("catalog")).toBe(false);
  });
});
