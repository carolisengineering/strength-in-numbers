import { localStorageAdapter, type StorageAdapter } from "../storage/storage";

/**
 * The Light / Dark / System preference (Spec 17.0 §6.1, D14, D15). React-free so `bootstrap()` can apply it
 * before anything renders.
 *
 * It is a per-device preference, not the user's data: the key lives under `sin:pref:`, which is deliberately
 * NOT in `USER_DATA_KEY_PREFIXES`, so logout keeps it (clearing it would flip the theme at every sign-out).
 * `tokens.css` reads the choice from `data-theme` on <html>; with no attribute (System) the OS decides.
 */
export const THEME_KEY = "sin:pref:theme";

export type ThemePreference = "light" | "dark" | "system";

function isForced(value: string | null): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

function apply(pref: ThemePreference): void {
  const root = document.documentElement;
  if (isForced(pref)) root.dataset.theme = pref;
  else delete root.dataset.theme;
}

/** The stored choice; anything unreadable or unknown means System. Never throws. */
export function readThemePreference(storage?: StorageAdapter): ThemePreference {
  try {
    const value = (storage ?? localStorageAdapter()).get(THEME_KEY);
    return isForced(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Re-apply the stored choice. The first statement of `bootstrap()`, before React mounts (AC23). */
export function applyStoredTheme(storage?: StorageAdapter): void {
  apply(readThemePreference(storage));
}

/** Store and apply a choice; System removes the key. A failed write still applies for this page view. */
export function setThemePreference(pref: ThemePreference, storage?: StorageAdapter): void {
  apply(pref);
  try {
    const store = storage ?? localStorageAdapter();
    if (isForced(pref)) store.set(THEME_KEY, pref);
    else store.remove(THEME_KEY);
  } catch {
    // Storage is unavailable: the choice holds until the page reloads.
  }
}
