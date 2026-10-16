import { afterEach, describe, expect, it } from "vitest";

import { clearUserData, isUserDataKey } from "../storage/clearUserData";
import { memoryStorageAdapter, type StorageAdapter } from "../storage/storage";
import { applyStoredTheme, readThemePreference, setThemePreference, THEME_KEY } from "./theme";

const html = () => document.documentElement;

afterEach(() => {
  delete html().dataset.theme;
});

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

describe("AC22 — choosing applies and persists", () => {
  it.each(["light", "dark"] as const)("%s sets data-theme on <html> and stores the choice", (pref) => {
    const storage = memoryStorageAdapter();
    setThemePreference(pref, storage);
    expect(html().dataset.theme).toBe(pref);
    expect(storage.get(THEME_KEY)).toBe(pref);
  });

  it("System removes the attribute and the key", () => {
    const storage = memoryStorageAdapter({ [THEME_KEY]: "dark" });
    html().dataset.theme = "dark";
    setThemePreference("system", storage);
    expect(html().dataset.theme).toBeUndefined();
    expect(storage.get(THEME_KEY)).toBeNull();
  });

  it("a fresh applyStoredTheme re-applies the stored choice", () => {
    const storage = memoryStorageAdapter({ [THEME_KEY]: "light" });
    applyStoredTheme(storage);
    expect(html().dataset.theme).toBe("light");
  });

  it("still applies when the write fails", () => {
    expect(() => setThemePreference("dark", throwing)).not.toThrow();
    expect(html().dataset.theme).toBe("dark");
  });
});

describe("AC23 — the stored value is read defensively", () => {
  it.each(["purple", "", "DARK", "<b>x</b>"])("ignores %j (System)", (value) => {
    applyStoredTheme(memoryStorageAdapter({ [THEME_KEY]: value }));
    expect(html().dataset.theme).toBeUndefined();
  });

  it("falls back to System when storage throws", () => {
    expect(() => applyStoredTheme(throwing)).not.toThrow();
    expect(readThemePreference(throwing)).toBe("system");
    expect(html().dataset.theme).toBeUndefined();
  });
});

describe("AC24 — a device preference survives logout", () => {
  it("is not user data, so clearUserData leaves it", () => {
    expect(isUserDataKey(THEME_KEY)).toBe(false);
    const storage = memoryStorageAdapter({ [THEME_KEY]: "dark", "sin:workout:drafts": "{}" });
    clearUserData(storage);
    expect(storage.get(THEME_KEY)).toBe("dark");
    expect(storage.get("sin:workout:drafts")).toBeNull();
  });
});
