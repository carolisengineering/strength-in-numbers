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
 * a storage failure is reported once (static tag) and the line is simply not shown — the workout is in the cloud.
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

  function load(): LandedItem[] {
    let raw: string | null;
    try {
      raw = storage.get(LANDED_KEY);
    } catch (error) {
      reportOnce(error);
      return [];
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

  let items: LandedItem[] = load();

  function write(next: LandedItem[]): void {
    items = next;
    if (next.length === 0) drop();
    else {
      try {
        storage.set(LANDED_KEY, JSON.stringify({ v: 1, userId, items: next }));
      } catch (error) {
        reportOnce(error);
      }
    }
    for (const listener of [...listeners]) listener();
  }

  const without = (workoutId: string) => {
    if (!items.some((i) => i.workoutId === workoutId)) return;
    write(items.filter((i) => i.workoutId !== workoutId));
  };

  return {
    list: () => items,
    add: (item) => write([item, ...items.filter((i) => i.workoutId !== item.workoutId)].slice(0, LANDED_MAX)),
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
