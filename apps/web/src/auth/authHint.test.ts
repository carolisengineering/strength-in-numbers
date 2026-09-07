import { afterEach, describe, expect, it, vi } from "vitest";

import { resetConfigCache } from "../config";
import { authHint, hasAuth0Session } from "./authHint";

const CLIENT = "spaClient123";
const scoped = (value: string) =>
  `auth0.${CLIENT}.is.authenticated=${value}`;

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
});

describe("AC4 — authHint.hasAuth0Session", () => {
  it("is true when the client-scoped hint cookie is `true`", () => {
    expect(hasAuth0Session(CLIENT, scoped("true"))).toBe(true);
  });

  it("is false when the hint cookie is absent", () => {
    expect(hasAuth0Session(CLIENT, "theme=dark; tz=UTC")).toBe(false);
    expect(hasAuth0Session(CLIENT, "")).toBe(false);
  });

  it("is false when the hint cookie is `false`", () => {
    expect(hasAuth0Session(CLIENT, scoped("false"))).toBe(false);
  });

  it("ignores a hint cookie scoped to a different client id", () => {
    expect(
      hasAuth0Session(CLIENT, "auth0.someOtherClient.is.authenticated=true"),
    ).toBe(false);
  });

  it("finds the hint among unrelated cookies in the jar", () => {
    expect(
      hasAuth0Session(CLIENT, `theme=dark; ${scoped("true")}; tz=Europe%2FLondon`),
    ).toBe(true);
  });

  it("accepts the legacy unscoped auth0.is.authenticated cookie", () => {
    expect(hasAuth0Session(CLIENT, "auth0.is.authenticated=true")).toBe(true);
  });

  it("is false for a blank client id", () => {
    expect(hasAuth0Session("", scoped("true"))).toBe(false);
  });

  it("reads document.cookie and the configured client id by default", () => {
    resetConfigCache();
    vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", CLIENT);
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    document.cookie = scoped("true");

    expect(authHint.hasAuth0Session()).toBe(true);
  });
});
