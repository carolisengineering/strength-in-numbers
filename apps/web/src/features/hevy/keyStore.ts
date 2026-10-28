import { z } from "zod";
import { localStorageAdapter, type StorageAdapter } from "../../storage/storage";

/**
 * Spec 20.0 AC2, AC3: the Hevy API key, on this device only. It is never sent to Strength in Numbers and never
 * logged; the only code that sends it anywhere is `client/hevyClient.ts`, in the `api-key` header of a request to
 * Hevy. "Save and remember" stores `{ v: 1, key }` under `sin:hevy:key:<userId>` (a user-data prefix, so logout
 * clears it); "Use for this visit only", or storage that refuses the write, keeps it in this store's memory.
 * React-free.
 */

/** The shape of a Hevy key: the lenient 8-4-4-4-12 hex form, as `@sin/core` `ids.ts` reads ids. */
export const HEVY_KEY_SHAPE = z.guid();

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
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
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
    },

    set(userId, key, { remember }) {
      const storageKey = hevyKeyStorageKey(userId);
      let remembered = false;
      if (remember) {
        try {
          storage.set(storageKey, JSON.stringify({ v: 1, key }));
          remembered = true;
        } catch {
          remembered = false;
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
      memory.delete(userId);
      quietly(() => storage.remove(hevyKeyStorageKey(userId)));
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's store, over the browser's storage. */
export const hevyKeyStore: HevyKeyStore = createKeyStore(localStorageAdapter());
