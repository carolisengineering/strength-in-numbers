import { useSyncExternalStore } from "react";

/**
 * Minor 197 (owner ruling O2): how far the one shared template read has got. The read itself reports here
 * (`hevyTemplatesQuery`), so every screen watching it, including one that joins a read already running, shows the
 * real page. One read at a time: the query key is shared, so TanStack runs at most one.
 */
export type TemplatesProgress = { page: number; pageCount: number } | null;

let current: TemplatesProgress = null;
const listeners = new Set<() => void>();

function publish(next: TemplatesProgress): void {
  current = next;
  for (const listener of listeners) listener();
}

/** The read has got this far ("page 2 of 3" while page 3 is on its way). */
export function reportTemplatesPage(p: { page: number; pageCount: number }): void {
  publish({ page: p.page, pageCount: p.pageCount });
}

/** The read is over (done, failed or canceled): the next one starts from nothing. */
export function endTemplatesRead(): void {
  publish(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTemplatesProgress(): TemplatesProgress {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
