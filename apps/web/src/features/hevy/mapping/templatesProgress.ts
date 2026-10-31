import { useSyncExternalStore } from "react";

/**
 * Minor 197 (owner ruling O2): how far the one shared template read has got. The read itself reports here
 * (`hevyTemplatesQuery`), so every screen watching it, including one that joins a read already running, shows the
 * real page. The query key is shared, so TanStack runs one read at a time; but a canceled read's `finally` can land
 * after the next read has begun, so each read has a token and only the latest may report or end (minor 230).
 */
export type TemplatesProgress = { page: number; pageCount: number } | null;

let current: TemplatesProgress = null;
let latest = 0;
const listeners = new Set<() => void>();

function publish(next: TemplatesProgress): void {
  current = next;
  for (const listener of listeners) listener();
}

/** A read starts on "page 1 of 1"; the token it returns is what it reports and ends with. */
export function beginTemplatesRead(): number {
  latest += 1;
  publish({ page: 1, pageCount: 1 });
  return latest;
}

/** The read has got this far ("page 2 of 3" while page 3 is on its way). Ignored unless `token` is the latest read. */
export function reportTemplatesPage(token: number, p: { page: number; pageCount: number }): void {
  if (token === latest) publish({ page: p.page, pageCount: p.pageCount });
}

/** The read is over (done, failed or canceled): the next one starts from nothing. Ignored for an older read. */
export function endTemplatesRead(token: number): void {
  if (token === latest) publish(null);
}

/** Tests only: forget every read. */
export function resetTemplatesProgress(): void {
  latest += 1;
  publish(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTemplatesProgress(): TemplatesProgress {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
