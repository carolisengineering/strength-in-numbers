import { z } from "zod";
import { localStorageAdapter, type StorageAdapter } from "../../storage/storage";

/**
 * Spec 20.0 AC2, AC3: the Hevy API key, on this device only. It is never sent to Strength in Numbers and never
 * logged; the only code that sends it anywhere is `client/hevyClient.ts`, in the `api-key` header of a request to
 * Hevy. "Save and remember" stores `{ v: 1, key }` under `sin:hevy:key:<userId>` (a user-data prefix, so logout
 * clears it); "Use for this visit only", or storage that refuses the write, keeps it in this store's memory.
 * React-free.
 */

/** The shape of a Hevy key: an RFC 9562 UUID (version 1–8; the owner checked a real key, minor 166). */
export const HEVY_KEY_SHAPE = z.uuid();

const StoredKeySchema = z.object({ v: z.literal(1), key: HEVY_KEY_SHAPE });

export const hevyKeyStorageKey = (userId: string): string => `sin:hevy:key:${userId}`;

export interface HevyKeyStore {
  get(userId: string): string | null;
  /** `remembered` is false for a visit-only key and when storage refused the write (the key is then in memory). */
  set(userId: string, key: string, opts: { remember: boolean }): { remembered: boolean };
  remove(userId: string): void;
  subscribe(listener: () => void): () => void;
}

export function createKeyStore(storage: StorageAdapter): HevyKeyStore {
  const memory = new Map<string, string>();
  // Minor 174: the parsed stored key per user, so a render never re-reads and re-parses storage.
  const cache = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  // Another tab's save or remove reaches this one through the `storage` event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) cache.clear();
    else if (event.key.startsWith(hevyKeyStorageKey(""))) cache.delete(event.key.slice(hevyKeyStorageKey("").length));
    else return;
    notify();
  };
  const quietly = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Storage is unavailable: the memory copy is the only copy.
    }
  };

  return {
    get(userId) {
      const inMemory = memory.get(userId);
      if (inMemory !== undefined) return inMemory;
      if (cache.has(userId)) return cache.get(userId)!;
      const read = readStored(userId);
      cache.set(userId, read);
      return read;
    },

    set(userId, key, { remember }) {
      cache.delete(userId);
      const storageKey = hevyKeyStorageKey(userId);
      let remembered = false;
      if (remember) {
        try {
          storage.set(storageKey, JSON.stringify({ v: 1, key }));
          remembered = true;
        } catch {
          remembered = false;
          // Minor 169: an older remembered key must not come back after a reload.
          quietly(() => storage.remove(storageKey));
        }
      } else {
        quietly(() => storage.remove(storageKey));
      }
      if (remembered) memory.delete(userId);
      else memory.set(userId, key);
      notify();
      return { remembered };
    },

    remove(userId) {
      cache.delete(userId);
      memory.delete(userId);
      quietly(() => storage.remove(hevyKeyStorageKey(userId)));
      notify();
    },

    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
  };

  function readStored(userId: string): string | null {
    const storageKey = hevyKeyStorageKey(userId);
    let raw: string | null;
    try {
      raw = storage.get(storageKey);
    } catch {
      return null;
    }
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const stored = StoredKeySchema.safeParse(parsed);
    if (stored.success) return stored.data.key;
    quietly(() => storage.remove(storageKey));
    return null;
  }
}

/** The app's store, over the browser's storage. */
export const hevyKeyStore: HevyKeyStore = createKeyStore(localStorageAdapter());
