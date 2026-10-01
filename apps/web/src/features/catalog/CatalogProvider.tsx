import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useApi } from "../../auth/useApi";
import { localStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { createCatalogStore, type CatalogStore } from "./catalogStore";

const CatalogStoreContext = createContext<CatalogStore | null>(null);

export interface CatalogProviderProps {
  /** `Me.id` — scopes the persisted catalog and recents (Spec 06.0 AC9). */
  userId: string;
  /** Defaults to `localStorageAdapter()`; tests pass an in-memory adapter. */
  storage?: StorageAdapter;
  children: ReactNode;
}

/**
 * Creates the one catalog store for a signed-in user (Spec 06.0 §6.6, AC22).
 * Spec 06.0 ships this but does not mount it; Spec 06.1 places it under the
 * protected layout with `user.id`.
 *
 * `useApi()` returns a render-stable client, so the store is created once per
 * `userId` and survives re-renders.
 */
export function CatalogProvider({ userId, storage, children }: CatalogProviderProps) {
  const api = useApi();
  const store = useMemo(
    () => createCatalogStore({ api, storage: storage ?? localStorageAdapter(), userId }),
    [api, storage, userId],
  );

  return (
    <CatalogStoreContext.Provider value={store}>{children}</CatalogStoreContext.Provider>
  );
}

export function useCatalogStore(): CatalogStore {
  const store = useContext(CatalogStoreContext);
  if (!store) {
    throw new Error("useCatalog() must be used inside <CatalogProvider>");
  }
  return store;
}
