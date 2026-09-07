import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config";

const VALID = {
  VITE_AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
  VITE_AUTH0_CLIENT_ID: "spa-client-abc123",
  VITE_AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  VITE_API_BASE_URL: "https://si-api-ft2f.onrender.com",
  VITE_APP_ENV: "staging",
} as const;

/** VALID minus one key (modelled as an explicit `undefined`, like an unset var). */
const without = (key: string): Record<string, unknown> => ({
  ...VALID,
  [key]: undefined,
});

const REQUIRED = [
  "VITE_AUTH0_DOMAIN",
  "VITE_AUTH0_CLIENT_ID",
  "VITE_AUTH0_AUDIENCE",
  "VITE_API_BASE_URL",
] as const;

describe("AC2 — env config schema", () => {
  it("parses a complete valid env into a frozen config", () => {
    const config = loadConfig({ ...VALID });
    expect(config).toEqual(VALID);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('defaults VITE_APP_ENV to "local" when absent', () => {
    expect(loadConfig(without("VITE_APP_ENV")).VITE_APP_ENV).toBe("local");
  });

  it("throws on an out-of-enum VITE_APP_ENV", () => {
    expect(() => loadConfig({ ...VALID, VITE_APP_ENV: "prod" })).toThrow(
      /VITE_APP_ENV/,
    );
  });

  it.each(REQUIRED)("throws a ConfigError when %s is missing", (key) => {
    expect(() => loadConfig(without(key))).toThrow(ConfigError);
    expect(() => loadConfig(without(key))).toThrow(
      new RegExp(`${key}: is required`),
    );
  });

  it.each(REQUIRED)("throws when %s is blank whitespace", (key) => {
    expect(() => loadConfig({ ...VALID, [key]: "   " })).toThrow(new RegExp(key));
  });

  it("rejects a scheme on VITE_AUTH0_DOMAIN", () => {
    expect(() =>
      loadConfig({
        ...VALID,
        VITE_AUTH0_DOMAIN: "https://dev-tenant.us.auth0.com",
      }),
    ).toThrow(/VITE_AUTH0_DOMAIN/);
  });

  it("rejects a trailing slash on VITE_AUTH0_DOMAIN", () => {
    expect(() =>
      loadConfig({ ...VALID, VITE_AUTH0_DOMAIN: "dev-tenant.us.auth0.com/" }),
    ).toThrow(/VITE_AUTH0_DOMAIN/);
  });

  it("rejects a trailing slash on VITE_API_BASE_URL", () => {
    expect(() =>
      loadConfig({
        ...VALID,
        VITE_API_BASE_URL: "https://si-api-ft2f.onrender.com/",
      }),
    ).toThrow(/VITE_API_BASE_URL/);
  });

  it("rejects a non-URL VITE_AUTH0_AUDIENCE", () => {
    expect(() =>
      loadConfig({ ...VALID, VITE_AUTH0_AUDIENCE: "not a url" }),
    ).toThrow(/VITE_AUTH0_AUDIENCE/);
  });

  it("names every offending var in one error message", () => {
    try {
      loadConfig({});
      expect.unreachable("expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.issues).toHaveLength(4);
      expect(configError.message).toMatch(
        /VITE_AUTH0_DOMAIN[\s\S]*VITE_API_BASE_URL/,
      );
    }
  });
});
