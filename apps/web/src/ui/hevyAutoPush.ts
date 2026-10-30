import { localStorageAdapter, type StorageAdapter } from "../storage/storage";

/**
 * Spec 20.2 AC23: "Send each workout to Hevy when I finish it" — off by default, a per-device preference like
 * keep-awake. The key lives under `sin:pref:`, which is NOT in `USER_DATA_KEY_PREFIXES`, so logout keeps it (the Hevy
 * key itself is user data, so a different person signing in sends nothing). Only "on" is stored.
 */
export const HEVY_AUTO_PUSH_KEY = "sin:pref:hevy-auto-push";

/** The stored choice; anything unreadable or unknown means off. Never throws. */
export function isHevyAutoPushOn(storage?: StorageAdapter): boolean {
  try {
    return (storage ?? localStorageAdapter()).get(HEVY_AUTO_PUSH_KEY) === "on";
  } catch {
    return false;
  }
}

/** Store a choice; off removes the key. A failed write is ignored (the choice holds for this page view only). */
export function setHevyAutoPush(on: boolean, storage?: StorageAdapter): void {
  try {
    const store = storage ?? localStorageAdapter();
    if (on) store.set(HEVY_AUTO_PUSH_KEY, "on");
    else store.remove(HEVY_AUTO_PUSH_KEY);
  } catch {
    // Storage is unavailable.
  }
}
