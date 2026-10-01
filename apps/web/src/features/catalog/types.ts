import type { Exercise } from "@sin/core";

export type CatalogStatus = "idle" | "loading" | "error";

/**
 * The store's snapshot (Spec 06.0 §3). Immutable: every change produces a new
 * object, which is what `useSyncExternalStore` compares by reference. `rows`
 * is the raw stored set and can include forked origins — render from
 * `useCatalog().visible`, not from here.
 */
export interface CatalogState {
  readonly rows: readonly Exercise[];
  readonly recentIds: readonly string[];
  readonly syncToken: string | null;
  readonly status: CatalogStatus;
  /** Clock value of the last successful refresh; in-memory only. */
  readonly lastRefreshAt: number | null;
}
