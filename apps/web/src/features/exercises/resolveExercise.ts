import type { Exercise } from "@sin/core";

export type Resolution =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "found"; row: Exercise }
  | { kind: "redirect"; to: string }
  | { kind: "deleted" };

/** Newest first by `createdAt`, then the lower id (AC19). */
const newestFirst = (a: Exercise, b: Exercise): number => {
  const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * What the exercise page shows for `id` (Spec 18.2 AC19, Review Focus 1). `rows` is the raw store
 * (origins included). A row in the store resolves at once, whatever the sync status; a fork origin
 * with an active fork redirects to its newest active fork; only after a sync can an unknown id be
 * called deleted.
 */
export function resolveExercise(
  rows: readonly Exercise[],
  id: string,
  sync: { synced: boolean; failed: boolean },
): Resolution {
  const [newestFork] = rows.filter((r) => r.isActive && r.forkedFromExerciseId === id).sort(newestFirst);
  if (newestFork) return { kind: "redirect", to: newestFork.id };
  const row = rows.find((r) => r.id === id && r.isActive);
  if (row) return { kind: "found", row };
  if (sync.synced) return { kind: "deleted" };
  if (sync.failed) return { kind: "error" };
  return { kind: "loading" };
}
