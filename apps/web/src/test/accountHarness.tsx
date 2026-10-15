import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import { resetConfigCache } from "../config";
import { ProfileScreen } from "../features/me/ProfileScreen";
import { ME_QUERY_KEY } from "../features/me/useMe";

export const API_BASE_URL = "https://api.example.test";
export const EXPORT_URL = `${API_BASE_URL}/v1/account/export`;
export const ACCOUNT_URL = `${API_BASE_URL}/v1/account`;
export const ME_URL = `${API_BASE_URL}/v1/me`;
export const EXPORT_FILENAME = "strength-in-numbers-export-2026-10-14.json";

export const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: "Sam",
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** Call from beforeEach (the file must have vi.mock'd @auth0/auth0-react itself — vi.mock is per-file). */
export function stubAccountEnv(): void {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");
}
export function unstubAccountEnv(): void {
  resetConfigCache();
  vi.unstubAllEnvs();
}

export const problem = (status: number, slug: string, headers: Record<string, string> = {}) =>
  new HttpResponse(
    JSON.stringify({ type: `https://strengthinnumbers.app/problems/${slug}`, title: slug, status, detail: "d", instance: "req-1" }),
    { status, headers: { "content-type": "application/problem+json", ...headers } },
  );

export const exportOk = (body = '{"formatVersion":1}') =>
  http.get(EXPORT_URL, () =>
    new HttpResponse(body, {
      status: 200,
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${EXPORT_FILENAME}"` },
    }),
  );

export const deleteOk = (purgeEligibleAt = "2026-11-13T02:00:00.000Z") =>
  http.delete(ACCOUNT_URL, () => HttpResponse.json({ deletedAt: "2026-10-14T02:00:00.000Z", purgeEligibleAt }, { status: 202 }));

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
}

/** ProfileScreen alone, `["me"]` pre-seeded (no /v1/me request), inside a memory router (useSession needs one). */
export function renderProfile(queryClient = makeQueryClient()) {
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  const router = createMemoryRouter([{ path: "/", element: <ProfileScreen /> }]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}
