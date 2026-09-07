import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@auth0/auth0-react", () => ({
  Auth0Provider: ({ children }: { children: ReactNode }) => children,
  useAuth0: () => ({ isAuthenticated: true, isLoading: false }),
}));

import { resetConfigCache, type Config } from "../config";
import {
  AUTH0_WORKER_URL,
  Auth0ProviderWithNavigate,
  buildAuth0Config,
  defaultOnRedirectCallback,
} from "./Auth0ProviderWithNavigate";

const CONFIG: Config = {
  VITE_AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
  VITE_AUTH0_CLIENT_ID: "spaClient123",
  VITE_AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  VITE_API_BASE_URL: "https://api.example.test",
  VITE_APP_ENV: "staging",
};

describe("AC7 — tokens live in memory only", () => {
  it("configures memory cache + refresh-token rotation with no iframe fallback", () => {
    const options = buildAuth0Config(CONFIG);
    expect(options.cacheLocation).toBe("memory");
    expect(options.useRefreshTokens).toBe(true);
    expect(options.useRefreshTokensFallback).toBe(false);
  });

  it("never selects localstorage", () => {
    expect(JSON.stringify(buildAuth0Config(CONFIG))).not.toMatch(/localstorage/i);
  });

  it("source scan: no module under src/ reads or writes localStorage / sessionStorage", () => {
    const modules = import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const offenders = Object.entries(modules)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, source]) => /\b(?:localStorage|sessionStorage)\b/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});

describe("AC8 — refresh-token worker is self-hosted", () => {
  it("points workerUrl at a same-origin absolute path, never blob:", () => {
    const { workerUrl } = buildAuth0Config(CONFIG);
    expect(workerUrl).toBe("/auth0-spa-js.worker.production.js");
    expect(workerUrl).toBe(AUTH0_WORKER_URL);
    expect(workerUrl?.startsWith("/")).toBe(true);
    expect(workerUrl).not.toMatch(/^(?:blob|data|https?):/);
    // step 7: the dist/ existence check + the render.yaml CSP `worker-src` parse
    // are AC8's remaining clauses.
  });
});

describe("AC5 — login kicks off PKCE (config seam)", () => {
  it("requests offline_access and wires audience + /callback redirect from config", () => {
    const { authorizationParams } = buildAuth0Config(CONFIG);
    expect(authorizationParams?.scope).toContain("offline_access");
    expect(authorizationParams?.audience).toBe(
      "https://api.strengthinnumbers.app",
    );
    expect(authorizationParams?.redirect_uri).toMatch(
      /^https?:\/\/[^/]+\/callback$/,
    );
    // the click -> loginWithRedirect RTL assertion is step 6.
  });
});

describe("defaultOnRedirectCallback", () => {
  it("swaps the URL to appState.returnTo, defaulting to /app", () => {
    const spy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => undefined);

    defaultOnRedirectCallback({ returnTo: "/app/profile" });
    expect(spy.mock.lastCall?.slice(1)).toEqual(["", "/app/profile"]);

    defaultOnRedirectCallback();
    expect(spy.mock.lastCall?.slice(1)).toEqual(["", "/app"]);

    spy.mockRestore();
  });
});

describe("AC7 — a mocked authenticated render writes nothing to web storage", () => {
  beforeEach(() => {
    resetConfigCache();
    vi.stubEnv("VITE_AUTH0_DOMAIN", CONFIG.VITE_AUTH0_DOMAIN);
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", CONFIG.VITE_AUTH0_CLIENT_ID);
    vi.stubEnv("VITE_AUTH0_AUDIENCE", CONFIG.VITE_AUTH0_AUDIENCE);
    vi.stubEnv("VITE_API_BASE_URL", CONFIG.VITE_API_BASE_URL);
    vi.stubEnv("VITE_APP_ENV", CONFIG.VITE_APP_ENV);
  });

  afterEach(() => {
    resetConfigCache();
    vi.unstubAllEnvs();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("leaves localStorage / sessionStorage empty and sets no JWT-shaped cookie", () => {
    localStorage.clear();
    sessionStorage.clear();

    render(
      <Auth0ProviderWithNavigate>
        <span>signed in</span>
      </Auth0ProviderWithNavigate>,
    );

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}\./);
  });
});
