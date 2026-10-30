import { useSyncExternalStore } from "react";

import { localStorageAdapter, watchExternalWrites, type StorageAdapter } from "../storage/storage";

/**
 * Spec 20.2 AC23: "Send each workout to Hevy when I finish it" — off by default, a per-device preference like
 * keep-awake. The key lives under `sin:pref:`, which is NOT in `USER_DATA_KEY_PREFIXES`, so logout keeps it (the Hevy
 * key itself is user data, so a different person signing in sends nothing). Only "on" is stored.
 */
export const HEVY_AUTO_PUSH_KEY = "sin:pref:hevy-auto-push";

/**
 * A choice the device's storage refused (private mode, a full quota): it holds for this page view, so the switch and
 * what auto-push does agree. `null` once a write succeeds. Only for the device's own storage, not a passed adapter.
 */
let unsaved: boolean | null = null;

/** The stored choice; anything unreadable or unknown means off. Never throws. */
export function isHevyAutoPushOn(storage?: StorageAdapter): boolean {
  if (storage === undefined && unsaved !== null) return unsaved;
  try {
    return (storage ?? localStorageAdapter()).get(HEVY_AUTO_PUSH_KEY) === "on";
  } catch {
    return false;
  }
}

/** This tab's readers of the device's choice (minor 264). */
const listeners = new Set<() => void>();

/** Store a choice; off removes the key. A failed write holds for this page view only. */
export function setHevyAutoPush(on: boolean, storage?: StorageAdapter): void {
  try {
    const store = storage ?? localStorageAdapter();
    if (on) store.set(HEVY_AUTO_PUSH_KEY, "on");
    else store.remove(HEVY_AUTO_PUSH_KEY);
    if (storage === undefined) unsaved = null;
  } catch {
    if (storage === undefined) unsaved = on;
  }
  if (storage === undefined) listeners.forEach((l) => l());
}

/**
 * Minor 264: hears a change to the device's choice, from this tab or another (the `storage` event). Another tab's write
 * is what storage now holds, so it replaces a choice this page view kept after a refused write.
 */
export function subscribeHevyAutoPush(listener: () => void): () => void {
  listeners.add(listener);
  const unwatch = watchExternalWrites(HEVY_AUTO_PUSH_KEY, () => {
    unsaved = null;
    listener();
  });
  return () => {
    listeners.delete(listener);
    unwatch();
  };
}

/** The device's choice, following every change (the switch, and what the workout screen shows with it). */
export function useHevyAutoPushOn(): boolean {
  return useSyncExternalStore(subscribeHevyAutoPush, () => isHevyAutoPushOn());
}
