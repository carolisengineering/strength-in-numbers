import { z } from "zod";
import { reportError } from "../../../observability/reportError";
import type { StorageAdapter } from "../../../storage/storage";

/** Spec 06.7 §4: under the `sin:workout:` prefix, so every sign-out clears it. */
export const LANDED_KEY = "sin:workout:landed";
/** At most this many entries, newest first. */
export const LANDED_MAX = 5;

const LandedItemSchema = z.object({
  workoutId: z.string(),
  /** The summary heading's count (lifts with a row that rose, Spec 17.6 / minor 476); `null` for `ours` and `elsewhere`. */
  lifts: z.number().int().min(0).nullable(),
  how: z.enum(["landed", "ours", "elsewhere"]),
});
export type LandedItem = z.infer<typeof LandedItemSchema>;

const LandedFileSchema = z.object({ v: z.literal(1), userId: z.string(), items: z.array(LandedItemSchema) });

export interface LandedStore {
  /** Newest first. */
  list(): readonly LandedItem[];
  add(item: LandedItem): void;
  /** The line was tapped, dismissed or left. */
  remove(workoutId: string): void;
  /** That workout's summary opened, by any route. */
  clearWorkout(workoutId: string): void;
  subscribe(listener: () => void): () => void;
}

export interface LandedStoreDeps {
  storage: StorageAdapter;
  userId: string;
  report?: (error: unknown) => void;
}

/**
 * Spec 06.7 AC27, §6.9, D12: the finishes that landed while their summary was not open, for the Workouts screen's
 * one-time "saved" line. React-free. A file that doesn't parse or belongs to another user is cleared and reads empty;
 * a storage failure is reported once (static tag); the line still works for this page load from memory, and after a
 * reload it may be missing (a failed write) or show once more (a failed removal). Each change re-reads the file first,
 * so another tab's entry is kept; after a failed write, this page load's entries stay in memory (minor 630).
 */
export function createLandedStore({ storage, userId, report: reportDep }: LandedStoreDeps): LandedStore {
  const report = reportDep ?? ((error: unknown) => reportError(error, { source: "workout-storage" }));
  let reported = false;
  const reportOnce = (error: unknown) => {
    if (reported) return;
    reported = true;
    report(error);
  };
  const listeners = new Set<() => void>();

  const drop = () => {
    try {
      storage.remove(LANDED_KEY);
    } catch (error) {
      reportOnce(error);
    }
  };

  /** The stored entries, or `null` when storage can't be read. */
  function read(): LandedItem[] | null {
    let raw: string | null;
    try {
      raw = storage.get(LANDED_KEY);
    } catch (error) {
      reportOnce(error);
      return null;
    }
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      drop();
      return [];
    }
    const file = LandedFileSchema.safeParse(parsed);
    if (!file.success || file.data.userId !== userId) {
      drop();
      return [];
    }
    return file.data.items;
  }

  let items: LandedItem[] = read() ?? [];
  /** False once a write failed: from then on this page load's entries live in memory, and the file can't be trusted. */
  let writable = true;
  /** Workouts this tab removed while a write was failing (minor 712's merge must not bring them back). */
  const removedUnwritten = new Set<string>();
  /**
   * What a change starts from (minor 630): the file as it is now, so another tab's entry is kept; the entries in memory
   * when it can't be read. Minor 712: after a failed write, this tab's memory merged with whatever the file holds now,
   * so the next write that succeeds keeps another tab's entries too.
   */
  const current = (): LandedItem[] => {
    const file = read();
    if (writable) return file ?? items;
    if (file === null) return items;
    // A line this tab removed while the file couldn't be written is still in the file; it stays gone (code review).
    // Accepted (minor 765): entries carry no landing time, so this tab's entries go first and another tab's newest can
    // be cut at `LANDED_MAX`. The one-time line may then show once more, which the store's doc allows.
    const fresh = file.filter((f) => !items.some((i) => i.workoutId === f.workoutId) && !removedUnwritten.has(f.workoutId));
    return [...items, ...fresh].slice(0, LANDED_MAX);
  };

  function write(next: LandedItem[]): void {
    items = next;
    try {
      if (next.length === 0) storage.remove(LANDED_KEY);
      else storage.set(LANDED_KEY, JSON.stringify({ v: 1, userId, items: next }));
      writable = true; // the file holds this tab's entries again (minor 712)
      removedUnwritten.clear();
    } catch (error) {
      writable = false;
      reportOnce(error);
    }
    for (const listener of [...listeners]) listener();
  }

  const without = (workoutId: string) => {
    const now = current();
    const has = (list: readonly LandedItem[]) => list.some((i) => i.workoutId === workoutId);
    // In memory but no longer in the file (another tab removed it): still written, so this tab's line goes too.
    if (!has(now) && !has(items)) return;
    removedUnwritten.add(workoutId); // cleared once a write succeeds
    write(now.filter((i) => i.workoutId !== workoutId));
  };

  return {
    list: () => items,
    add: (item) => write([item, ...current().filter((i) => i.workoutId !== item.workoutId)].slice(0, LANDED_MAX)),
    remove: without,
    clearWorkout: without,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
