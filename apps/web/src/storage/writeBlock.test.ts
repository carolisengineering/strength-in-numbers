import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import { logoutAndClear } from "../auth/logout";
import { createCatalogStore } from "../features/catalog/catalogStore";
import { exerciseId, makeExercise } from "../test/catalogFixtures";
import { clearUserData } from "./clearUserData";
import { blockUserDataWrites, localStorageAdapter, resetUserDataWritesForTests } from "./storage";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";

beforeEach(() => {
  window.localStorage.clear();
  resetUserDataWritesForTests();
});
afterEach(() => {
  window.localStorage.clear();
  resetUserDataWritesForTests();
});

describe("AC13 — after logout begins, nothing user-scoped is written to storage", () => {
  it("set() of a user-data key is a silent no-op once blocked (no throw), on any adapter instance", () => {
    blockUserDataWrites();
    const adapter = localStorageAdapter();
    expect(() => adapter.set("sin:catalog:v1:u", "x")).not.toThrow();
    expect(() => localStorageAdapter().set("sin:recents:v1:u", "x")).not.toThrow();
    expect(window.localStorage.getItem("sin:catalog:v1:u")).toBeNull();
    expect(window.localStorage.getItem("sin:recents:v1:u")).toBeNull();
  });

  it("keys that are not user data are still written", () => {
    blockUserDataWrites();
    localStorageAdapter().set("theme", "dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("get, keys, remove and clearUserData keep working", () => {
    window.localStorage.setItem("sin:catalog:v1:u", "x");
    window.localStorage.setItem("theme", "dark");
    blockUserDataWrites();
    const adapter = localStorageAdapter();
    expect(adapter.get("theme")).toBe("dark");
    expect(adapter.keys().sort()).toEqual(["sin:catalog:v1:u", "theme"]);
    clearUserData(adapter);
    expect(adapter.keys()).toEqual(["theme"]);
    adapter.remove("theme");
    expect(adapter.keys()).toEqual([]);
  });

  it("writes are allowed before the block is tripped and again after the test reset helper", () => {
    localStorageAdapter().set("sin:catalog:v1:u", "before");
    expect(window.localStorage.getItem("sin:catalog:v1:u")).toBe("before");
    blockUserDataWrites();
    localStorageAdapter().set("sin:catalog:v1:u", "blocked");
    expect(window.localStorage.getItem("sin:catalog:v1:u")).toBe("before");
    resetUserDataWritesForTests();
    localStorageAdapter().set("sin:catalog:v1:u", "after");
    expect(window.localStorage.getItem("sin:catalog:v1:u")).toBe("after");
  });
});

describe("AC13 — a catalog refresh resolving after logoutAndClear leaves no catalog key behind", () => {
  function setup() {
    let release!: (body: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          release = resolve;
        }),
    );
    const store = createCatalogStore({
      api: { request, post: vi.fn() } as unknown as Pick<ApiClient, "request" | "post">,
      storage: localStorageAdapter(),
      userId: USER,
    });
    const body = { exercises: [makeExercise({ id: exerciseId(1) })], syncToken: "1.100" };
    return { store, release: () => release(body) };
  }
  const catalogKeys = () => Object.keys(window.localStorage).filter((k) => k.startsWith("sin:catalog:"));

  it("control: without a logout the refresh does persist", async () => {
    const { store, release } = setup();
    const refreshing = store.refresh(true);
    release();
    await refreshing;
    expect(catalogKeys()).toHaveLength(1);
  });

  it("with a logout in between, nothing is persisted", async () => {
    const { store, release } = setup();
    const refreshing = store.refresh(true);
    logoutAndClear(vi.fn(() => Promise.resolve()));
    release();
    await refreshing;
    expect(catalogKeys()).toEqual([]);
  });
});
