import { z } from "zod";
import { RoutineItemInputSchema } from "@sin/core";

import { reportError } from "../../observability/reportError";
import type { StorageAdapter } from "../../storage/storage";
import { remainingSeconds, type RestTimer } from "./restTimer";

/** Under the existing `sin:workout:` prefix, so logout and its write block already cover it (Spec 17.1 AC47, AC51). */
export const REST_KEY = "sin:workout:rest";
/** A stored start further ahead than this means the device clock was moved back (AC46). */
export const FUTURE_TOLERANCE_MS = 5000;

// The 900 s bound is the routine schema's, never a literal here (§8).
const restBound = RoutineItemInputSchema.shape.restSeconds;
const RestFileSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  workoutId: z.string(),
  startedAt: z.number(),
  durationS: z.number().int().min(1).refine((d) => restBound.safeParse(d).success),
});

export interface RestStore {
  get(): RestTimer | null;
  subscribe(listener: () => void): () => void;
  start(durationS: number): void;
  clear(): void;
  readonly now: () => number;
}

export interface RestStoreDeps {
  storage: StorageAdapter;
  userId: string;
  workoutId: string;
  now?: () => number;
  report?: (error: unknown) => void;
}

/**
 * The rest timer for one (user, workout) pair (Spec 17.1 §6.10, AC46). React-free; an external store read with
 * `useSyncExternalStore`, so only the readout and the line re-render. Writes are immediate (one tiny write per log).
 * The only thing ever reported is the storage error, tagged with a static source; never a time, a length or a name.
 */
export function createRestStore(deps: RestStoreDeps): RestStore {
  const { storage, userId, workoutId } = deps;
  const now = deps.now ?? Date.now;
  const report = deps.report ?? ((error: unknown) => reportError(error, { source: "workout-rest" }));
  let reported = false;
  const reportOnce = (error: unknown) => {
    if (reported) return;
    reported = true;
    report(error);
  };
  const listeners = new Set<() => void>();

  function drop(): void {
    try {
      storage.remove(REST_KEY);
    } catch {
      // Ignored: the value is not read again.
    }
  }

  function load(): RestTimer | null {
    let raw: string | null;
    try {
      raw = storage.get(REST_KEY);
    } catch (error) {
      reportOnce(error);
      return null;
    }
    if (raw === null) return null;
    let parsed: ReturnType<typeof RestFileSchema.safeParse> | null;
    try {
      parsed = RestFileSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    const data = parsed?.success ? parsed.data : null;
    // Stale or tampered values are the normal case, so silent: another user, another workout, a moved clock.
    if (data === null || data.userId !== userId || data.workoutId !== workoutId || data.startedAt > now() + FUTURE_TOLERANCE_MS) {
      drop();
      return null;
    }
    const restored = { startedAt: data.startedAt, durationS: data.durationS };
    if (remainingSeconds(restored, now()) === 0) {
      drop(); // an expired rest restores as no timer, not "Ready"
      return null;
    }
    return restored;
  }

  let timer = load();

  function persist(): void {
    try {
      if (timer === null) storage.remove(REST_KEY);
      else storage.set(REST_KEY, JSON.stringify({ v: 1, userId, workoutId, startedAt: timer.startedAt, durationS: timer.durationS }));
    } catch (error) {
      reportOnce(error);
    }
  }

  function emit(): void {
    for (const listener of listeners) listener();
  }

  return {
    get: () => timer,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: (durationS) => {
      timer = { startedAt: now(), durationS };
      persist();
      emit();
    },
    clear: () => {
      if (timer === null) return;
      timer = null;
      persist();
      emit();
    },
    now,
  };
}

/** Remove the stored value when it belongs to `workoutId`, without building a store. */
export function clearWorkoutRest(storage: StorageAdapter, workoutId: string): void {
  try {
    const raw = storage.get(REST_KEY);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && (parsed as { workoutId?: unknown }).workoutId === workoutId) storage.remove(REST_KEY);
  } catch {
    // Unreadable: the next store built drops it.
  }
}

export interface RestStores {
  forWorkout(workoutId: string): RestStore;
  /** Finish / discard / gone: works whether or not that workout's store is cached. */
  clearWorkout(workoutId: string): void;
}

/** One cached store for the active workout; it outlives the session screen, so leaving and returning keeps the rest (AC50). */
export function createRestStores(storage: StorageAdapter, userId: string, now?: () => number): RestStores {
  let current: { workoutId: string; store: RestStore } | null = null;
  return {
    forWorkout: (workoutId) => {
      if (current?.workoutId === workoutId) return current.store;
      const store = createRestStore({ storage, userId, workoutId, ...(now ? { now } : {}) });
      current = { workoutId, store };
      return store;
    },
    clearWorkout: (workoutId) => {
      if (current?.workoutId === workoutId) current.store.clear();
      // Always also the stored value: `clear()` is a no-op when the memory timer is already null.
      clearWorkoutRest(storage, workoutId);
    },
  };
}
