import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Validator as ValidatorType } from "@seriousme/openapi-schema-validator";
import { Validator } from "@seriousme/openapi-schema-validator";
import { assertRouteHasResponseSchema } from "../../src/app.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier, FakeUserRepository, makeUser } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const JSON_HEADERS = { ...BEARER, "content-type": "application/json" };

/**
 * Registers the AC2 / AC7 probe routes on the root instance (never shipped —
 * Spec 03.0 §5). They exercise the type-provider wiring directly, independent of
 * `/v1/me`.
 */
async function appWithProbes() {
  const { app } = await buildTestApp();
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Root-scope route with a Zod body — AC2 request path. Carries a response
  // schema too so it satisfies the structural egress-allowlist guard.
  r.post(
    "/__probe/echo",
    {
      schema: {
        body: z.strictObject({ name: z.string().max(5) }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async () => ({ ok: true }),
  );

  // Handler returns a shape that violates its own `response` schema — AC2
  // response path. The extra `leaked` key and the wrong-typed `ok` must never
  // reach the wire.
  r.get(
    "/__probe/bad-response",
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    async () =>
      ({ ok: "not-a-boolean", leaked: "SCHEMA_INTERNAL_abc" }) as unknown as {
        ok: boolean;
      },
  );

  // Handler returns fields not in the `response` schema — AC7 allowlist.
  r.get(
    "/__probe/over-wide",
    { schema: { response: { 200: z.object({ id: z.string() }) } } },
    async () =>
      ({ id: "row-1", authSub: "auth0|secret", deletedAt: "2020-01-01" }) as unknown as {
        id: string;
      },
  );

  return app;
}

describe("AC2 — Zod validation errors keep the RFC 9457 contract, without leaking", () => {
  it("root-scope: a bad Zod body → 422 problem+json with populated errors[]", async () => {
    const app = await appWithProbes();
    const res = await app.inject({
      method: "POST",
      url: "/__probe/echo",
      headers: { "content-type": "application/json" },
      payload: { name: "waytoolong" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().type).toContain("validation-error");
    expect(res.json().errors.length).toBeGreaterThan(0);
    expect(res.json().errors[0]).toMatchObject({
      path: "name",
      message: expect.any(String),
    });
  });

  it("errors[].message is a constraint phrase, never an echo of the submitted value", async () => {
    const app = await appWithProbes();
    const secret = "tok_live_5ecretV4lue";
    const res = await app.inject({
      method: "POST",
      url: "/__probe/echo",
      headers: { "content-type": "application/json" },
      payload: { name: secret },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).not.toContain(secret);
    expect(res.json().errors[0].message).toBe("must be at most 5 characters");
  });

  it("/v1 scope: a token-shaped bad enum value is absent from the 422 body", async () => {
    const repo = new FakeUserRepository([makeUser({ authSub: "auth0|p" })]);
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|p" })),
    });
    const secret = "tok_live_sup3rsecret";
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { unitPreference: secret },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
    expect(JSON.stringify(res.json())).not.toContain(secret);
    expect(res.json().errors[0]).toMatchObject({
      path: "unitPreference",
      message: "must be one of: kg, lb",
    });
  });

  it("a handler that violates its own response schema → 500 internal, no schema text in detail", async () => {
    const app = await appWithProbes();
    const logged: unknown[] = [];
    app.log.error = ((obj: unknown) => {
      logged.push(obj);
    }) as typeof app.log.error;

    const res = await app.inject({ method: "GET", url: "/__probe/bad-response" });
    expect(res.statusCode).toBe(500);
    expect(res.json().type).toContain("internal");
    const blob = JSON.stringify(res.json());
    expect(blob).not.toContain("SCHEMA_INTERNAL_abc");
    expect(blob).not.toContain("not-a-boolean");
    expect(res.json().detail).toBe("An unexpected error occurred.");
    // The failing shape is logged server-side.
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("AC7 — response schema is a field allowlist", () => {
  it("probe route: fields absent from the response schema are stripped from the wire", async () => {
    const app = await appWithProbes();
    const res = await app.inject({ method: "GET", url: "/__probe/over-wide" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "row-1" });
    expect(res.json()).not.toHaveProperty("authSub");
    expect(res.json()).not.toHaveProperty("deletedAt");
  });

  it("GET /v1/me returns exactly the MeSchema fields and nothing else", async () => {
    const repo = new FakeUserRepository([makeUser({ authSub: "auth0|k" })]);
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|k" })),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(
      [
        "createdAt",
        "displayName",
        "email",
        "id",
        "isNewUser",
        "timezone",
        "unitPreference",
      ].sort(),
    );
  });
});

describe("AC4 — OpenAPI 3.1 document served, scoped to the public surface", () => {
  it("GET /openapi.json needs no auth and returns application/json", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("validates against the OpenAPI 3.1 meta-schema", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json();
    const validator: ValidatorType = new Validator();
    const result = await validator.validate(doc);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
  });

  it("contains /v1/me (GET + PATCH) with camelCase schemas", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(doc.openapi.startsWith("3.1")).toBe(true);
    expect(doc.paths["/v1/me"]).toBeDefined();
    expect(doc.paths["/v1/me"].get).toBeDefined();
    expect(doc.paths["/v1/me"].patch).toBeDefined();
    const props =
      doc.paths["/v1/me"].get.responses["200"].content["application/json"].schema
        .properties;
    for (const key of ["displayName", "unitPreference", "createdAt"]) {
      expect(props).toHaveProperty(key);
    }
  });

  it("excludes /v1/_authcheck, /healthz, /readyz, /openapi.json and any servers block", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(Object.keys(doc.paths)).toEqual(["/v1/me"]);
    expect(doc.paths).not.toHaveProperty("/v1/_authcheck");
    expect(doc.paths).not.toHaveProperty("/healthz");
    expect(doc.paths).not.toHaveProperty("/readyz");
    expect(doc.servers ?? []).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain("onrender.com");
  });

  it("is a boot-time constant — app.swagger() is called at most once across N requests", async () => {
    const { app } = await buildTestApp();
    const spy = vi.spyOn(app, "swagger");
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: "GET", url: "/openapi.json" });
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("declares the bearerAuth security scheme and requires it document-wide", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe("SB — every non-hidden route must declare a response schema (structural egress allowlist)", () => {
  it("buildApp assembles: every real route already declares one or is hidden", async () => {
    await expect(buildTestApp()).resolves.toBeDefined();
  });

  it("throws for a route with a body and no response schema", () => {
    expect(() =>
      assertRouteHasResponseSchema({ method: "GET", url: "/v1/leaky", schema: {} }),
    ).toThrow(/response schema/i);
  });

  it("is not prefix-gated — a non-/v1 route is guarded too", () => {
    expect(() =>
      assertRouteHasResponseSchema({ method: "GET", url: "/v2/things", schema: {} }),
    ).toThrow(/response schema/i);
    expect(() =>
      assertRouteHasResponseSchema({ method: "POST", url: "/stats", schema: undefined }),
    ).toThrow(/response schema/i);
  });

  it("exempts hidden routes", () => {
    expect(() =>
      assertRouteHasResponseSchema({
        method: "GET",
        url: "/healthz",
        schema: { hide: true },
      }),
    ).not.toThrow();
  });

  it("exempts body-less methods", () => {
    expect(() =>
      assertRouteHasResponseSchema({ method: ["HEAD", "OPTIONS"], url: "/v1/me", schema: {} }),
    ).not.toThrow();
    expect(() =>
      assertRouteHasResponseSchema({ method: "OPTIONS", url: "/anything", schema: undefined }),
    ).not.toThrow();
  });

  it("passes when a response schema is present", () => {
    expect(() =>
      assertRouteHasResponseSchema({
        method: ["GET", "HEAD"],
        url: "/v1/thing",
        schema: { response: { 200: z.object({ id: z.string() }) } },
      }),
    ).not.toThrow();
  });

  // The guard is wired as an `onRoute` hook on the root instance; these prove it
  // actually reaches routes registered inside a `register(..., { prefix })`
  // child scope (where the real `/v1` routes live), not just direct calls.
  it("the onRoute hook fires for a child-scope route with no response schema → assembly fails", async () => {
    const app = Fastify({ logger: false });
    app.addHook("onRoute", (ro) =>
      assertRouteHasResponseSchema({ method: ro.method, url: ro.url, schema: ro.schema }),
    );
    app.register(
      async (child) => {
        child.get("/thing", async () => ({ ok: true }));
      },
      { prefix: "/v1" },
    );
    await expect(app.ready()).rejects.toThrow(/response schema/i);
    await app.close();
  });

  it("the same child-scope route WITH a response schema assembles cleanly", async () => {
    const app = Fastify({ logger: false });
    app.addHook("onRoute", (ro) =>
      assertRouteHasResponseSchema({ method: ro.method, url: ro.url, schema: ro.schema }),
    );
    app.register(
      async (child) => {
        child.get(
          "/thing",
          { schema: { response: { 200: { type: "object" } } } },
          async () => ({ ok: true }),
        );
      },
      { prefix: "/v1" },
    );
    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});

describe("AC3 — /v1/me behaviour preserved on the contract pipeline", () => {
  const withUser = (authSub: string) => ({
    userRepository: new FakeUserRepository([makeUser({ authSub })]),
    tokenVerifier: fakeVerifier(() => authContext({ authSub })),
  });

  it("an unknown PATCH body key → 422 validation-error (UpdateMeSchema is .strict())", async () => {
    const { app } = await buildTestApp(withUser("auth0|ac3a"));
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { nickname: "x" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
  });

  it("an invalid IANA timezone → 422 via the UpdateMeSchema .refine() (P6)", async () => {
    const { app } = await buildTestApp(withUser("auth0|ac3b"));
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { timezone: "Mars/Phobos" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({ path: "timezone" });
  });

  it("a valid PATCH still round-trips: 200 with the change reflected", async () => {
    const { app } = await buildTestApp(withUser("auth0|ac3c"));
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { unitPreference: "lb" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().unitPreference).toBe("lb");
  });
});
