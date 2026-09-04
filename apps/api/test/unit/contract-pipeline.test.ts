import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Validator as ValidatorType } from "@seriousme/openapi-schema-validator";
import { Validator } from "@seriousme/openapi-schema-validator";
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

  // Root-scope route with a Zod body — AC2 request path.
  r.post(
    "/__probe/echo",
    { schema: { body: z.strictObject({ name: z.string().max(5) }) } },
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
});
