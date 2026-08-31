import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../../src/config.js";

const base: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL:
    "postgresql://u:p@localhost:5432/sin?sslmode=require&connection_limit=8",
  AUTH0_ISSUER: "https://si-staging.us.auth0.com/",
  AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  AUTH0_CLAIM_NAMESPACE: "https://strengthinnumbers.app/",
  WEB_ORIGIN: "http://localhost:5173,https://si-web-staging.onrender.com",
};

const without = (key: string): Record<string, string> => {
  const env = { ...base };
  delete env[key];
  return env;
};

describe("loadConfig — happy path (Criterion 2)", () => {
  it("parses a complete valid environment", () => {
    const cfg = loadConfig(base);
    expect(cfg.nodeEnv).toBe("test");
    expect(cfg.port).toBe(3000);
    expect(cfg.databaseUrl).toContain("postgresql://");
    expect(cfg.auth0.issuer).toBe("https://si-staging.us.auth0.com/");
    expect(cfg.auth0.audience).toBe("https://api.strengthinnumbers.app");
    expect(cfg.auth0.claimNamespace).toBe("https://strengthinnumbers.app/");
    expect(cfg.auth0.jwksUri).toBe(
      "https://si-staging.us.auth0.com/.well-known/jwks.json",
    );
    expect(cfg.webOrigins).toEqual([
      "http://localhost:5173",
      "https://si-web-staging.onrender.com",
    ]);
  });

  it("applies defaults for the optional vars", () => {
    const cfg = loadConfig(base);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.serviceName).toBe("si-api");
    expect(cfg.otelExporterUrl).toBeUndefined();
  });

  it("honours provided optionals", () => {
    const cfg = loadConfig({
      ...base,
      LOG_LEVEL: "debug",
      SERVICE_NAME: "si-api-test",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
    });
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.serviceName).toBe("si-api-test");
    expect(cfg.otelExporterUrl).toBe("http://otel:4318");
  });

  it("coerces PORT to a number", () => {
    expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
  });

  it("trims whitespace around WEB_ORIGIN entries", () => {
    const cfg = loadConfig({
      ...base,
      WEB_ORIGIN: " http://localhost:5173 , https://example.com ",
    });
    expect(cfg.webOrigins).toEqual([
      "http://localhost:5173",
      "https://example.com",
    ]);
  });
});

describe("loadConfig — rejects invalid config, names the var (Criterion 2)", () => {
  it.each([
    "PORT",
    "DATABASE_URL",
    "AUTH0_ISSUER",
    "AUTH0_AUDIENCE",
    "AUTH0_CLAIM_NAMESPACE",
    "WEB_ORIGIN",
  ])("throws ConfigError naming %s when missing", (key) => {
    expect(() => loadConfig(without(key))).toThrow(ConfigError);
    expect(() => loadConfig(without(key))).toThrow(new RegExp(key));
  });

  it("rejects a blank WEB_ORIGIN", () => {
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "   " })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects a WEB_ORIGIN entry with a path", () => {
    expect(() =>
      loadConfig({ ...base, WEB_ORIGIN: "https://app.example.com/cb" }),
    ).toThrow(/WEB_ORIGIN/);
  });

  it("rejects a wildcard WEB_ORIGIN", () => {
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "*" })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects AUTH0_ISSUER without a trailing slash", () => {
    expect(() =>
      loadConfig({ ...base, AUTH0_ISSUER: "https://si-staging.us.auth0.com" }),
    ).toThrow(/AUTH0_ISSUER/);
  });

  it("rejects a non-https AUTH0_ISSUER in production", () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        AUTH0_ISSUER: "http://localhost:9999/",
      }),
    ).toThrow(/AUTH0_ISSUER/);
  });

  it("allows an http AUTH0_ISSUER outside production (local dev IdP)", () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: "development",
      AUTH0_ISSUER: "http://localhost:9999/",
    });
    expect(cfg.auth0.issuer).toBe("http://localhost:9999/");
    expect(cfg.auth0.jwksUri).toBe(
      "http://localhost:9999/.well-known/jwks.json",
    );
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      loadConfig({ ...base, DATABASE_URL: "mysql://u:p@localhost/sin" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig({ ...base, PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadConfig({ ...base, PORT: "0" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "staging" })).toThrow(
      /NODE_ENV/,
    );
  });

  it("rejects an invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it("aggregates every problem into one message", () => {
    const env = without("PORT");
    delete env.AUTH0_AUDIENCE;
    try {
      loadConfig(env);
      expect.unreachable("loadConfig should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/PORT/);
      expect((err as Error).message).toMatch(/AUTH0_AUDIENCE/);
    }
  });
});
