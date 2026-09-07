import { renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mocks.getAccessTokenSilently,
    logout: mocks.logout,
  }),
}));

import { resetConfigCache } from "../config";
import { server } from "../test/msw/server";
import { useApi } from "./useApi";

const BASE_URL = "https://api.example.test";

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");
  mocks.getAccessTokenSilently.mockReset().mockResolvedValue("access-token");
  mocks.logout.mockReset();
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

describe("useApi", () => {
  it("returns the same client across re-renders while the Auth0 fns are stable", () => {
    const { result, rerender } = renderHook(() => useApi());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it("maps { ignoreCache: true } to getAccessTokenSilently({ cacheMode: 'off' }) on a 401 retry", async () => {
    let n = 0;
    server.use(
      http.get(`${BASE_URL}/v1/me`, () => {
        n += 1;
        return n === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({ id: "u_1" }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useApi());
    await expect(result.current.get("/v1/me")).resolves.toEqual({ id: "u_1" });

    expect(mocks.getAccessTokenSilently).toHaveBeenCalledTimes(2);
    expect(mocks.getAccessTokenSilently).toHaveBeenNthCalledWith(1);
    expect(mocks.getAccessTokenSilently).toHaveBeenNthCalledWith(2, {
      cacheMode: "off",
    });
  });

  it("onAuthLost logs out with logoutParams.returnTo on a lost session (double 401)", async () => {
    server.use(
      http.get(
        `${BASE_URL}/v1/me`,
        () =>
          new HttpResponse(
            JSON.stringify({
              type: "https://strengthinnumbers.app/problems/unauthenticated",
              title: "Unauthenticated",
              status: 401,
            }),
            { status: 401, headers: { "content-type": "application/problem+json" } },
          ),
      ),
    );

    const { result } = renderHook(() => useApi());
    await expect(result.current.get("/v1/me")).rejects.toBeInstanceOf(Error);

    expect(mocks.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });
});
