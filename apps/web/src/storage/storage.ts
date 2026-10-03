import { isUserDataKey } from "./clearUserData";

/**
 * The persistence seam for user-scoped client data (Spec 06.0 §3). The catalog
 * store takes one of these instead of touching `window.localStorage`, so it is
 * testable without a DOM; Spec 06.2 reuses the same seam.
 *
 * React-free. Implementations may throw (quota, disabled storage) — callers
 * own the handling.
 */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

// Process-wide, not per adapter: the three logout sites each build their own adapter and none holds
// the catalog store's. It is never cleared in production — the page is about to unload through the
// Auth0 redirect (Spec 06.1 §6.7).
let userDataWritesBlocked = false;

/**
 * Called first by `logoutAndClear`: from here on a user-data `set()` is a silent no-op, so a request
 * still in flight (a catalog refresh) cannot re-persist what logout just cleared. Silent, not a throw:
 * a throw would trip the catalog store's one-time `reportError` and flip it to in-memory mode.
 */
export function blockUserDataWrites(): void {
  userDataWritesBlocked = true;
}

/** Test-only: clears the write block between tests. */
export function resetUserDataWritesForTests(): void {
  userDataWritesBlocked = false;
}

/**
 * `window.localStorage` behind the adapter. The property is read on every
 * call, never at construction: some privacy modes throw on the access itself,
 * and building the adapter must not throw.
 */
export function localStorageAdapter(): StorageAdapter {
  const ls = (): Storage => window.localStorage;
  return {
    get: (key) => ls().getItem(key),
    set: (key, value) => {
      if (userDataWritesBlocked && isUserDataKey(key)) return;
      ls().setItem(key, value);
    },
    remove: (key) => {
      ls().removeItem(key);
    },
    keys: () => {
      const storage = ls();
      const out: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    },
  };
}

/**
 * Call `onWrite` when another tab of this origin changes `key` (or clears every key). The `storage`
 * event never fires in the tab that wrote, so this tab's own writes are not reported. Returns an
 * unsubscribe. Spec 06.2 AC19 uses it to stop a second tab corrupting the outbox.
 */
export function watchExternalWrites(key: string, onWrite: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key === key || event.key === null) onWrite();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** An in-memory adapter for tests. */
export function memoryStorageAdapter(
  initial: Record<string, string> = {},
): StorageAdapter {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}
