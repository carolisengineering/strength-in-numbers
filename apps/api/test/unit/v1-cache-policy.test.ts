import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import {
  assertHttpCacheConfig,
  cacheControlFor,
  registerV1CachePolicy,
} from "../../src/plugins/cache-policy.js";
import { InvalidTokenError } from "../../src/errors/app-error.js";
import { buildTestApp, limitsWith } from "../helpers/build-test-app.js";
import { fakeVerifier } from "../helpers/fakes.js";

/**
 * #18 (with #17): one `Cache-Control` policy for every `/v1` response, set by a
 * `/v1` scope `onSend` hook — never by hand in a handler.
 *
 * - status ≥ 400 → `no-store`, whatever the route set;
 * - a route with `config.httpCache: "revalidate"` (it serves an `ETag`) →
 *   `private, no-cache`;
 * - everything else → `no-store` (no validator, so a stored copy could only be
 *   kept, never revalidated; `/v1/me` is PII).
 */

const BEARER = { authorization: "Bearer test-token" };
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("#18 — cacheControlFor", () => {
  it.each([
    [200, undefined, "no-store"],
    [201, undefined, "no-store"],
    [204, undefined, "no-store"],
    [200, "revalidate", "private, no-cache"],
    [304, "revalidate", "private, no-cache"],
    [404, "revalidate", "no-store"],
    [410, "revalidate", "no-store"],
    [500, undefined, "no-store"],
  ] as const)("status %i, httpCache %s → %s", (status, httpCache, expected) => {
    expect(cacheControlFor(status, httpCache)).toBe(expected);
  });
});

describe("#18 — assertHttpCacheConfig (structural)", () => {
  it("accepts no httpCache, and revalidate on a GET (with its HEAD twin)", () => {
    expect(() => assertHttpCacheConfig({ method: "POST", url: "/v1/x", config: {} })).not.toThrow();
    expect(() =>
      assertHttpCacheConfig({ method: "GET", url: "/v1/x", config: { httpCache: "revalidate" } }),
    ).not.toThrow();
    expect(() =>
      assertHttpCacheConfig({ method: ["GET", "HEAD"], url: "/v1/x", config: { httpCache: "revalidate" } }),
    ).not.toThrow();
  });

  it("rejects revalidate on a write route, and an unknown value", () => {
    expect(() =>
      assertHttpCacheConfig({ method: "POST", url: "/v1/x", config: { httpCache: "revalidate" } }),
    ).toThrow(/POST \/v1\/x.*httpCache/);
    expect(() =>
      assertHttpCacheConfig({ method: "GET", url: "/v1/y", config: { httpCache: "forever" as never } }),
    ).toThrow(/GET \/v1\/y.*httpCache/);
  });
});

describe("#18 — registerV1CachePolicy wires the structural check", () => {
  it("a route registered after it with a bad httpCache fails app assembly", async () => {
    for (const register of [
      (s: FastifyInstance) =>
        s.post("/x", { config: { httpCache: "revalidate" } }, async () => ({ ok: true })),
      (s: FastifyInstance) =>
        s.get("/y", { config: { httpCache: "forever" as never } }, async () => ({ ok: true })),
    ]) {
      const app = Fastify();
      await expect(async () => {
        await app.register(async (scope) => {
          registerV1CachePolicy(scope);
          register(scope);
        });
        await app.ready();
      }).rejects.toThrow(/httpCache/);
      await app.close();
    }
  });

  it("a GET with httpCache: revalidate assembles, its HEAD twin included", async () => {
    const app = Fastify();
    await app.register(async (scope) => {
      registerV1CachePolicy(scope);
      scope.get("/z", { config: { httpCache: "revalidate" } }, async () => ({ ok: true }));
    });
    const head = await app.inject({ method: "HEAD", url: "/z" });
    expect(head.headers["cache-control"]).toBe("private, no-cache");
    await app.close();
  });
});

describe("#18 — every /v1 response gets the policy", () => {
  it("GET and PATCH /v1/me (PII) → no-store", async () => {
    const { app } = await buildTestApp();
    const get = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(get.statusCode).toBe(200);
    expect(get.headers["cache-control"]).toBe("no-store");

    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: BEARER,
      payload: { unitPreference: "lb" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.headers["cache-control"]).toBe("no-store");
  });

  it("a workouts write and read → no-store", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");

    const active = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(active.statusCode).toBe(200);
    expect(active.headers["cache-control"]).toBe("no-store");
  });

  it("the catalog and reference reads (httpCache: revalidate) → private, no-cache", async () => {
    const { app } = await buildTestApp();
    for (const url of ["/v1/exercises", "/v1/muscle-groups", "/v1/equipment"]) {
      const res = await app.inject({ method: "GET", url, headers: BEARER });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("private, no-cache");
      expect(res.headers.etag, url).toBeDefined();
    }
  });

  it("an error from a revalidate route is no-store (it fails before the handler sets anything)", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/exercises?since=not-a-token", headers: BEARER });
    expect(res.statusCode).toBe(422);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.etag).toBeUndefined();
  });

  it("a 401 from the auth hook and a 429 from the limiter → no-store", async () => {
    const unauth = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res401 = await unauth.app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });
    expect(res401.statusCode).toBe(401);
    expect(res401.headers["cache-control"]).toBe("no-store");

    const limited = await buildTestApp({ rateLimits: limitsWith({ groups: { me: 1 } }) });
    const patch = () =>
      limited.app.inject({ method: "PATCH", url: "/v1/me", headers: BEARER, payload: { unitPreference: "kg" } });
    await patch();
    const res429 = await patch();
    expect(res429.statusCode).toBe(429);
    expect(res429.headers["cache-control"]).toBe("no-store");
  });

  it("routes outside /v1 keep their own headers", async () => {
    const { app } = await buildTestApp();
    const doc = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(doc.headers["cache-control"]).toBe("public, max-age=300");
  });
});
