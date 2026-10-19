import { localStorageAdapter, type StorageAdapter } from "../storage/storage";

/**
 * "Keep screen on during workouts" (#108): on by default, a per-device preference like the theme. The key lives
 * under `sin:pref:`, which is NOT in `USER_DATA_KEY_PREFIXES`, so logout keeps it. Only "off" is stored.
 */
export const KEEP_AWAKE_KEY = "sin:pref:keep-awake";

/** The stored choice; anything unreadable or unknown means on. Never throws. */
export function readKeepAwake(storage?: StorageAdapter): boolean {
  try {
    return (storage ?? localStorageAdapter()).get(KEEP_AWAKE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Store a choice; on removes the key. A failed write is ignored (the choice holds for this page view only). */
export function setKeepAwake(on: boolean, storage?: StorageAdapter): void {
  try {
    const store = storage ?? localStorageAdapter();
    if (on) store.remove(KEEP_AWAKE_KEY);
    else store.set(KEEP_AWAKE_KEY, "off");
  } catch {
    // Storage is unavailable.
  }
}

/** Whether this browser can hold a screen wake lock (the Screen Wake Lock API). */
export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}
