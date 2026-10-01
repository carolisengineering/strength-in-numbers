import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useCatalogStore } from "./CatalogProvider";
import { pickRecents, sortByName, visibleRows } from "./visibility";

/**
 * React binding for the catalog store (Spec 06.0 §6.6, AC22).
 * `useSyncExternalStore` re-renders this component whenever the store's
 * snapshot object changes. Mounting triggers a staleness-gated `refresh()`,
 * so calling the hook from several components costs one request at most.
 *
 * Render from `visible` / `recents`, never from `state.rows` — the raw rows
 * can include forked origins.
 */
export function useCatalog() {
  const store = useCatalogStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    void store.refresh();
  }, [store]);

  const visible = useMemo(() => sortByName(visibleRows(state.rows)), [state.rows]);
  const recents = useMemo(
    () => pickRecents(visible, state.recentIds),
    [visible, state.recentIds],
  );

  return {
    state,
    visible,
    recents,
    refresh: store.refresh,
    createCustom: store.createCustom,
    recordPick: store.recordPick,
  };
}
