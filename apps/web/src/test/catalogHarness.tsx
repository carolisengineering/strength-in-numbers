import type { Exercise } from "@sin/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { vi } from "vitest";

import { resetConfigCache } from "../config";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { catalogKey, recentsKey } from "../features/catalog/constants";
import { memoryStorageAdapter, type StorageAdapter } from "../storage/storage";

/**
 * Shared scaffolding for catalog component tests. Each test file still mocks
 * `@auth0/auth0-react` itself (`vi.mock` is hoisted per file) with a
 * `useAuth0()` that returns stable `getAccessTokenSilently` / `logout` fns.
 */
export const API_BASE_URL = "https://api.example.test";
export const USER_ID = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";

/** Call in `beforeEach`; pair with `vi.unstubAllEnvs()` + `resetConfigCache()` in `afterEach`. */
export function stubWebEnv(): void {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");
}

/** A storage adapter pre-loaded with a valid catalog + recents for `USER_ID`. */
export function seededStorage(
  rows: Exercise[],
  recentIds: string[] = [],
  syncToken: string | null = "1.100",
): StorageAdapter {
  return memoryStorageAdapter({
    [catalogKey(USER_ID)]: JSON.stringify({ version: 1, rows, syncToken }),
    [recentsKey(USER_ID)]: JSON.stringify({ version: 1, ids: recentIds }),
  });
}

export function CatalogTestProviders({
  storage,
  children,
}: {
  storage: StorageAdapter;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogProvider userId={USER_ID} storage={storage}>
        {children}
      </CatalogProvider>
    </QueryClientProvider>
  );
}
