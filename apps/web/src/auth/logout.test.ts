import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { memoryStorageAdapter, type StorageAdapter } from "../storage/storage";
import { logoutAndClear } from "./logout";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("AC20 — logoutAndClear", () => {
  it("clears user data before calling Auth0 logout with returnTo = the site origin", () => {
    const storage = memoryStorageAdapter({
      "sin:catalog:v1:user-a": "{}",
      theme: "dark",
    });
    let keysAtLogout: string[] | undefined;
    const auth0Logout = vi.fn(() => {
      keysAtLogout = storage.keys();
      return Promise.resolve();
    });

    logoutAndClear(auth0Logout, storage);

    expect(keysAtLogout).toEqual(["theme"]);
    expect(auth0Logout).toHaveBeenCalledTimes(1);
    expect(auth0Logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("still logs out when storage throws", () => {
    const throwing: StorageAdapter = {
      get: () => null,
      set: () => undefined,
      remove: () => undefined,
      keys: () => {
        throw new Error("denied");
      },
    };
    const auth0Logout = vi.fn(() => Promise.resolve());

    expect(() => logoutAndClear(auth0Logout, throwing)).not.toThrow();
    expect(auth0Logout).toHaveBeenCalledTimes(1);
  });

  it("is the only non-test source file that builds Auth0 logoutParams", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("logoutParams"))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([join("auth", "logout.ts")]);
  });
});
