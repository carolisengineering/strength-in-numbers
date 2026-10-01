import type { StorageAdapter } from "./storage";

/**
 * Every prefix under which the app persists user-scoped data. Anything new
 * that writes per-user data to storage adds its prefix here so logout clears
 * it (Spec 06.0 §3, AC20).
 */
export const USER_DATA_KEY_PREFIXES: readonly string[] = [
  "sin:catalog:",
  "sin:recents:",
];

export const isUserDataKey = (key: string): boolean =>
  USER_DATA_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

/**
 * Remove every user-scoped key — for every user, not only the current one.
 * Never throws: it runs on the logout path, which must always complete.
 */
export function clearUserData(storage: StorageAdapter): void {
  try {
    for (const key of storage.keys()) {
      if (isUserDataKey(key)) storage.remove(key);
    }
  } catch {
    // Storage is unavailable, so nothing was persisted and nothing can leak.
  }
}
