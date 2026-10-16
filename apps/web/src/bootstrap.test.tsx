import { act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@auth0/auth0-react", () => ({
  // Passthrough provider + a still-initialising SDK: `bootstrap` only needs to
  // prove the real tree mounts (BootstrapGate -> Spinner), not run auth.
  Auth0Provider: ({ children }: { children: ReactNode }) => children,
  useAuth0: () => ({ isLoading: true, isAuthenticated: false }),
}));

import { bootstrap } from "./bootstrap";
import { resetConfigCache } from "./config";

const VALID_ENV: Record<string, string> = {
  VITE_AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
  VITE_AUTH0_CLIENT_ID: "spa-client-abc123",
  VITE_AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  VITE_API_BASE_URL: "https://si-api-ft2f.onrender.com",
  VITE_APP_ENV: "local",
};

const stubEnv = (env: Record<string, string>): void => {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
};

describe("AC2 — main.tsx misconfiguration fallback", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    resetConfigCache();
    root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetConfigCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    root.remove();
    window.history.replaceState({}, "", "/");
  });

  it("mounts the app shell when every VITE_* var is valid", () => {
    stubEnv(VALID_ENV);

    act(() => {
      bootstrap(root);
    });

    expect(root.querySelector('[data-testid="spinner"]')).not.toBeNull();
    expect(root.textContent).not.toMatch(/not set up right/i);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("renders the static misconfigured fallback and logs when a required var is blank", () => {
    stubEnv({ ...VALID_ENV, VITE_AUTH0_DOMAIN: "" });

    act(() => {
      bootstrap(root);
    });

    expect(root.textContent).toMatch(/not set up right|missing configuration/i);
    expect(root.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain(
      "VITE_AUTH0_DOMAIN",
    );
  });
});

describe("17.0 AC23 — the stored theme is applied before React mounts", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    resetConfigCache();
    root = document.createElement("div");
    document.body.append(root);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.localStorage.removeItem("sin:pref:theme");
    delete document.documentElement.dataset.theme;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetConfigCache();
    root.remove();
  });

  it("sets data-theme from storage even when the config is broken (it runs before the config parse)", () => {
    stubEnv({ ...VALID_ENV, VITE_AUTH0_DOMAIN: "" });
    window.localStorage.setItem("sin:pref:theme", "dark");
    act(() => {
      bootstrap(root);
    });
    expect(root.textContent).toMatch(/not set up right/i); // the static fallback: no app mounted
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("is the first statement of bootstrap()", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "bootstrap.tsx"), "utf8");
    const body = source.slice(source.indexOf("export function bootstrap"));
    const firstStatement = body.split("\n").slice(1).find((line) => line.trim() && !line.trim().startsWith("//"));
    expect(firstStatement?.trim()).toBe("applyStoredTheme();");
  });
});
