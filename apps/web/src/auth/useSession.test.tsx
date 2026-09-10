import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isAuthenticated: true,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth.state,
}));

import { resetConfigCache } from "../config";
import { server } from "../test/msw/server";
import { useSession } from "./useSession";

const API_BASE_URL = "https://api.example.test";
const AUDIENCE = "https://api.strengthinnumbers.app";

const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: "Sam",
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", AUDIENCE);
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");

  auth.state.isAuthenticated = true;
  auth.state.loginWithRedirect = vi.fn();
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");

  server.use(
    http.get(`${API_BASE_URL}/v1/me`, () =>
      HttpResponse.json(ME, { status: 200 }),
    ),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderSession(path = "/app/profile") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useSession(), { wrapper });
}

describe("AC4 — useSession() surface (Spec 04.1 §2 / §6.3)", () => {
  it("exposes the [\"me\"] query body as user and the Auth0 isAuthenticated flag", async () => {
    const { result } = renderSession();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toBeUndefined(); // query pending
    await waitFor(() => expect(result.current.user).toEqual(ME));
  });

  it("login() delegates to the shared login() helper with the current path + search as returnTo", () => {
    const { result } = renderSession("/app/history/123?tab=sets");

    result.current.login();

    expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(auth.state.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: "/app/history/123?tab=sets" },
      authorizationParams: {
        audience: AUDIENCE,
        redirect_uri: `${window.location.origin}/callback`,
        scope: "openid profile email offline_access",
      },
    });
  });

  it("logout() calls Auth0 logout with returnTo = the site origin", () => {
    const { result } = renderSession();

    result.current.logout();

    expect(auth.state.logout).toHaveBeenCalledTimes(1);
    expect(auth.state.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("reports isAuthenticated=false and no user on a public route", () => {
    auth.state.isAuthenticated = false;
    const { result } = renderSession("/");

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeUndefined();
  });
});
