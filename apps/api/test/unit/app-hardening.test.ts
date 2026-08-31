import { describe, it, expect } from "vitest";
import { pino } from "pino";
import { buildApp } from "../../src/app.js";
import { buildTestApp, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier, FakeUserRepository } from "../helpers/fakes.js";

describe("buildApp logger wiring", () => {
  it("accepts a pre-built pino instance (Fastify v5 loggerInstance)", async () => {
    const app = await buildApp({
      config: testConfig(),
      logger: pino({ level: "silent" }),
      checkReadiness: async () => {},
      tokenVerifier: fakeVerifier(() => authContext()),
      userRepository: new FakeUserRepository(),
    });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });
});

describe("health endpoints (Criteria 3, 4)", () => {
  it("GET /healthz → 200 {status:ok}, no auth, echoes x-request-id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("honours an inbound x-request-id header", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "trace-42" },
    });
    expect(res.headers["x-request-id"]).toBe("trace-42");
  });

  it("GET /readyz → 200 when the check passes", async () => {
    const { app } = await buildTestApp({ checkReadiness: async () => {} });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /readyz → 503 problem+json when the check fails", async () => {
    const { app } = await buildTestApp({
      checkReadiness: async () => {
        throw new Error("SELECT 1 failed");
      },
    });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().type).toContain("not-ready");
    expect(JSON.stringify(res.json())).not.toContain("SELECT 1 failed");
  });

  it("caches the readiness probe within the TTL window", async () => {
    let calls = 0;
    const { app } = await buildTestApp({
      checkReadiness: async () => {
        calls += 1;
      },
      readinessTtlMs: 5_000,
    });
    await app.inject({ method: "GET", url: "/readyz" });
    await app.inject({ method: "GET", url: "/readyz" });
    await app.inject({ method: "GET", url: "/readyz" });
    expect(calls).toBe(1);
  });
});

describe("routing + error contract", () => {
  it("unknown route → 404 problem+json not-found", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().type).toContain("not-found");
    expect(res.json().instance).toBe(res.headers["x-request-id"]);
  });

  it("GET /v1/me with no bearer token → 401 unauthenticated (Criterion 5)", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().type).toContain("unauthenticated");
  });
});

describe("CORS (Criterion 15)", () => {
  it("preflight from a listed origin → 204 + allow + expose headers", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/me",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(String(res.headers["access-control-expose-headers"] ?? "")).toContain(
      "X-Request-Id",
    );
  });

  it("preflight from an unlisted origin → no allow-origin header", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/me",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("app hardening (Criterion 17)", () => {
  it("sends helmet security headers on every response", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("rejects a body over the 64 KB limit with 413 payload-too-large", async () => {
    const { app } = await buildTestApp();
    const oversized = "x".repeat(64 * 1024 + 16);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ displayName: oversized }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().type).toContain("payload-too-large");
  });
});
