import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { API_BASE_URL, ME, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { USER_ID } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { catalogHandlers } from "../../../test/workoutFake";
import { memoryStorageAdapter } from "../../../storage/storage";
import { CatalogProvider } from "../../catalog/CatalogProvider";
import { ME_QUERY_KEY } from "../../me/useMe";
import { HEVY_KEYS } from "../keys";
import { useSavePairingsDeps } from "./useSavePairingsDeps";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;

function wrapperFor(queryClient: QueryClient) {
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter([{ path: "/", element: <>{children}</> }]);
    return (
      <QueryClientProvider client={queryClient}>
        <CatalogProvider userId={USER_ID} storage={memoryStorageAdapter()}>
          <RouterProvider router={router} />
        </CatalogProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  server.use(...catalogHandlers([]));
});
afterEach(() => unstubAccountEnv());

describe("Minor 187 — the deps hook", () => {
  it("patchMapping writes the reply into the mapping cache and re-reads the status (AC28)", async () => {
    const reply = { pairs: [], sectionRules: [] };
    server.use(http.patch(MAPPING_URL, () => HttpResponse.json(reply)));
    const queryClient = makeQueryClient();
    queryClient.setQueryData(HEVY_KEYS.status(USER_ID), { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false });
    const { result } = renderHook(() => useSavePairingsDeps(), { wrapper: wrapperFor(queryClient) });
    await act(() => result.current.patchMapping({ upsert: [] }));
    expect(queryClient.getQueryData(HEVY_KEYS.mapping)).toEqual(reply);
    expect(queryClient.getQueryState(HEVY_KEYS.status(USER_ID))?.isInvalidated).toBe(true);
  });

  it("a refresh that leaves the catalog in error rejects, so savePairings can stop", async () => {
    server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({}, { status: 503 })));
    const { result } = renderHook(() => useSavePairingsDeps(), { wrapper: wrapperFor(makeQueryClient()) });
    await expect(result.current.refresh(true)).rejects.toThrow();
  });
});
