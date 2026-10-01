import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStorageAdapter, memoryStorageAdapter } from "./storage";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StorageAdapter implementations (Spec 06.0 §3)", () => {
  it.each([
    ["localStorageAdapter", () => localStorageAdapter()],
    ["memoryStorageAdapter", () => memoryStorageAdapter()],
  ] as const)("%s round-trips get / set / remove / keys", (_name, make) => {
    const storage = make();

    expect(storage.get("a")).toBeNull();
    storage.set("a", "1");
    storage.set("b", "2");
    expect(storage.get("a")).toBe("1");
    expect(storage.keys().sort()).toEqual(["a", "b"]);

    storage.remove("a");
    expect(storage.get("a")).toBeNull();
    expect(storage.keys()).toEqual(["b"]);
  });

  it("localStorageAdapter writes through to window.localStorage", () => {
    localStorageAdapter().set("sin:catalog:v1:u1", "{}");
    expect(window.localStorage.getItem("sin:catalog:v1:u1")).toBe("{}");
  });

  it("localStorageAdapter surfaces a storage failure to the caller", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => localStorageAdapter().get("a")).toThrow("SecurityError");
  });

  it("memoryStorageAdapter starts from the given entries and copies them", () => {
    const initial = { a: "1" };
    const storage = memoryStorageAdapter(initial);
    storage.set("b", "2");
    expect(storage.get("a")).toBe("1");
    expect(initial).toEqual({ a: "1" });
  });
});
