import type { StorageAdapter } from "./storage";

/**
 * Every prefix under which the app persists user-scoped data. Anything new
 * that writes per-user data to storage adds its prefix here so logout clears
 * it (Spec 06.0 §3, AC20).
 */
export const USER_DATA_KEY_PREFIXES: readonly string[] = [
  "sin:catalog:",
  "sin:recents:",
  "sin:workout:",
  // Spec 20.0 AC2: the Hevy key (`features/hevy/keyStore.ts`).
  "sin:hevy:",
];

export const isUserDataKey = (key: string): boolean =>
  USER_DATA_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

/** Spec 06.7 AC8: each account's workout outbox file is `sin:workout:outbox:<userId>` (the outbox builds its key from this). */
export const OUTBOX_FILE_PREFIX = "sin:workout:outbox:";
/** Spec 06.7 AC9: a per-account outbox file (never the legacy single file `sin:workout:outbox`). */
export const isOutboxFile = (key: string): boolean => key.startsWith(OUTBOX_FILE_PREFIX);

/**
 * Remove every user-scoped key — for every user, not only the current one — except those `keep` keeps (Spec 06.7
 * AC9: a forced sign-out keeps unsent workout data). Never throws: it runs on the logout path, which must always complete.
 */
export function clearUserData(storage: StorageAdapter, { keep }: { keep?: (key: string) => boolean } = {}): void {
  try {
    for (const key of storage.keys()) {
      if (isUserDataKey(key) && !keep?.(key)) storage.remove(key);
    }
  } catch {
    // Storage is unavailable, so nothing was persisted and nothing can leak.
  }
}
