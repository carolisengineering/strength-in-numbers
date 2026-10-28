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

import { ME, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { HEVY_USER_INFO_URL, USER_ID, VALID_KEY, clearHevyKey, setInstantPacing } from "../../test/hevyHarness";
import { server } from "../../test/msw/server";
import { ME_QUERY_KEY } from "../me/useMe";
import { HEVY_KEYS } from "./keys";
import { hevyKeyStore } from "./keyStore";
import { HEVY_COPY } from "./messages";
import { useHevyKey } from "./useHevyKey";

function wrapperFor(queryClient: QueryClient) {
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter([{ path: "/", element: <>{children}</> }]);
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
});
afterEach(() => {
  clearHevyKey();
  unstubAccountEnv();
});

describe("Minor 175 — a key check that finishes after unmount stores nothing", () => {
  it("aborts the check on unmount; the late reply is not stored", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(HEVY_USER_INFO_URL, async () => {
        await held;
        return HttpResponse.json({ data: { id: "h1", name: "Carol", url: "https://hevy.com/user/carol", username: "carol", is_pro: true } });
      }),
    );
    const { result, unmount } = renderHook(() => useHevyKey(), { wrapper: wrapperFor(makeQueryClient()) });
    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.save(VALID_KEY, { remember: true });
    });
    unmount();
    release();
    await expect(outcome).resolves.toEqual({ ok: false, message: HEVY_COPY.aborted });
    expect(hevyKeyStore.get(USER_ID)).toBeNull();
  });
});

describe("Minor 168 — Hevy status and user caches are per user", () => {
  it("each user has their own key under a shared prefix", () => {
    expect(HEVY_KEYS.user("a")).not.toEqual(HEVY_KEYS.user("b"));
    expect(HEVY_KEYS.user("a").slice(0, 2)).toEqual(HEVY_KEYS.userAll);
    expect(HEVY_KEYS.status("a")).toEqual(["hevy", "status", "a"]);
    expect(HEVY_KEYS.statusAll).toEqual(["hevy", "status"]);
  });
});
