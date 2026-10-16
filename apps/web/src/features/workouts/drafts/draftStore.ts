import { z } from "zod";
import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, WEIGHT_UNIT_VALUES } from "@sin/core";
import { reportError } from "../../../observability/reportError";
import type { StorageAdapter } from "../../../storage/storage";

/** Under the existing `sin:workout:` prefix, so logout and a lost session already clear it (Spec 06.5 §4). */
export const DRAFTS_KEY = "sin:workout:drafts";
export const DRAFT_DEBOUNCE_MS = 300;

const DraftFieldsSchema = z.object({
  weight: z.string(),
  reps: z.string(),
  distance: z.string(),
  minutes: z.string(),
  seconds: z.string(),
  rpe: z.string(),
  weightUnit: z.enum(WEIGHT_UNIT_VALUES),
  distanceUnit: z.enum(DISTANCE_UNIT_VALUES),
  setType: z.enum(SET_TYPE_VALUES),
});
/** The nine entry-row fields. `attemptKey` is deliberately absent: it is re-minted on restore (§4). */
export type DraftFields = z.infer<typeof DraftFieldsSchema>;

const DraftFileSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  workoutId: z.string(),
  byExercise: z.record(z.string(), DraftFieldsSchema),
});

export interface DraftStore {
  get(workoutExerciseId: string): DraftFields | undefined;
  set(workoutExerciseId: string, fields: DraftFields): void;
  /** Immediate, not debounced: a stale draft restoring after a log would be a visible bug. */
  clearExercise(workoutExerciseId: string): void;
  clearWorkout(workoutId: string): void;
  /** Drop entries for exercises no longer in the workout (AC10). */
  retainOnly(ids: ReadonlySet<string>): void;
  flush(): void;
  dispose(): void;
}

export interface DraftStoreDeps {
  storage: StorageAdapter;
  userId: string;
  workoutId: string;
  report?: (error: unknown) => void;
}

/**
 * The persisted entry-row drafts for one (user, workout) pair (Spec 06.5 §6.1). React-free: tests
 * drive it with `memoryStorageAdapter()` and fake timers. Values are measures only; the only thing
 * ever reported is the error, tagged with a static source.
 */
export function createDraftStore(deps: DraftStoreDeps): DraftStore {
  const { storage, userId, workoutId } = deps;
  const report = deps.report ?? ((error: unknown) => reportError(error, { source: "workout-drafts" }));
  let reported = false;
  const reportOnce = (error: unknown) => {
    if (reported) return;
    reported = true;
    report(error);
  };

  // A Map, not a plain object: a stored key such as "__proto__" is then just a key.
  const byExercise = new Map<string, DraftFields>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function dropStored(): void {
    try {
      storage.remove(DRAFTS_KEY);
    } catch {
      // Ignored either way: the value is not read again.
    }
  }

  function load(): void {
    let raw: string | null;
    try {
      raw = storage.get(DRAFTS_KEY);
    } catch (error) {
      reportOnce(error);
      return;
    }
    if (raw === null) return;
    let parsed: ReturnType<typeof DraftFileSchema.safeParse> | null;
    try {
      parsed = DraftFileSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      reportOnce(new Error("unreadable drafts"));
      dropStored();
      return;
    }
    // The normal stale case, so silent: another user, or a workout that is no longer this one.
    if (parsed.data.userId !== userId || parsed.data.workoutId !== workoutId) {
      dropStored();
      return;
    }
    for (const [id, fields] of Object.entries(parsed.data.byExercise)) byExercise.set(id, fields);
  }
  load();

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function write(): void {
    clearTimer();
    try {
      if (byExercise.size === 0) storage.remove(DRAFTS_KEY);
      else storage.set(DRAFTS_KEY, JSON.stringify({ v: 1, userId, workoutId, byExercise: Object.fromEntries(byExercise) }));
    } catch (error) {
      reportOnce(error);
    }
  }

  function schedule(): void {
    clearTimer();
    timer = setTimeout(write, DRAFT_DEBOUNCE_MS);
  }

  return {
    get: (id) => byExercise.get(id),
    set: (id, fields) => {
      if (disposed) return;
      // Copy the nine fields by name: a caller passing a wider object must not leak `attemptKey` to disk.
      byExercise.set(id, {
        weight: fields.weight,
        reps: fields.reps,
        distance: fields.distance,
        minutes: fields.minutes,
        seconds: fields.seconds,
        rpe: fields.rpe,
        weightUnit: fields.weightUnit,
        distanceUnit: fields.distanceUnit,
        setType: fields.setType,
      });
      schedule();
    },
    clearExercise: (id) => {
      if (!byExercise.delete(id)) return;
      write();
    },
    clearWorkout: (id) => {
      if (id !== workoutId) return;
      byExercise.clear();
      write();
    },
    retainOnly: (ids) => {
      let changed = false;
      for (const id of [...byExercise.keys()]) {
        if (!ids.has(id)) {
          byExercise.delete(id);
          changed = true;
        }
      }
      if (changed) schedule();
    },
    flush: () => {
      if (timer !== null) write();
    },
    dispose: () => {
      if (timer !== null) write();
      disposed = true;
    },
  };
}

/** Remove the stored value when it belongs to `workoutId`, without building a store (which would drop another workout's value). */
export function clearWorkoutDrafts(storage: StorageAdapter, workoutId: string): void {
  try {
    const raw = storage.get(DRAFTS_KEY);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && (parsed as { workoutId?: unknown }).workoutId === workoutId) {
      storage.remove(DRAFTS_KEY);
    }
  } catch {
    // Unreadable: the next store built for a workout drops it and reports.
  }
}

export interface DraftStores {
  forWorkout(workoutId: string): DraftStore;
  /** Finish / discard / gone: works whether or not that workout's store is cached. */
  clearWorkout(workoutId: string): void;
  flushAll(): void;
}

/** One cached store for the active workout; asking for another workout disposes (flushes) the old one. */
export function createDraftStores(storage: StorageAdapter, userId: string): DraftStores {
  let current: { workoutId: string; store: DraftStore } | null = null;
  return {
    forWorkout: (workoutId) => {
      if (current?.workoutId === workoutId) return current.store;
      current?.store.dispose();
      const store = createDraftStore({ storage, userId, workoutId });
      current = { workoutId, store };
      return store;
    },
    clearWorkout: (workoutId) => {
      if (current?.workoutId === workoutId) current.store.clearWorkout(workoutId);
      else clearWorkoutDrafts(storage, workoutId);
    },
    flushAll: () => current?.store.flush(),
  };
}
