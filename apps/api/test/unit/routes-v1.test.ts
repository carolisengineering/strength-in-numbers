import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import {
  FakeUserRepository,
  authContext,
  fakeVerifier,
  makeUser,
} from "../helpers/fakes.js";
import {
  AuthUnavailableError,
  InvalidTokenError,
} from "../../src/errors/app-error.js";

const BEARER = { authorization: "Bearer test-token" };
const JSON_HEADERS = { ...BEARER, "content-type": "application/json" };

describe("GET /v1/me — provisioning (Criterion 7)", () => {
  it("provisions on first sight of a sub; isNewUser true then false", async () => {
    const repo = new FakeUserRepository();
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|new" })),
    });

    const r1 = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().isNewUser).toBe(true);
    expect(repo.provisionCalls).toBe(1);

    const r2 = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(r2.json().isNewUser).toBe(false);
    expect(r2.json()).toMatchObject({
      email: "a@b.com",
      unitPreference: "kg",
      timezone: "UTC",
      displayName: null,
    });
  });

  it("401 invalid-token when a new sub has no email claim", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() =>
        authContext({
          authSub: "clients|m2m",
          email: undefined,
          emailVerified: undefined,
        }),
      ),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.statusCode).toBe(401);
    expect(res.json().type).toContain("invalid-token");
  });

  it("re-syncs email when the token's email has changed", async () => {
    const existing = makeUser({ authSub: "auth0|x", email: "old@b.com" });
    const repo = new FakeUserRepository([existing]);
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() =>
        authContext({ authSub: "auth0|x", email: "new@b.com" }),
      ),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.json().email).toBe("new@b.com");
    expect(repo.syncEmailCalls).toBe(1);
  });
});

describe("GET /v1/me — deleted account (Criterion 9)", () => {
  it("returns 403 account-deleted", async () => {
    const deleted = makeUser({ authSub: "auth0|del", deletedAt: new Date() });
    const { app } = await buildTestApp({
      userRepository: new FakeUserRepository([deleted]),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|del" })),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toContain("account-deleted");
  });
});

describe("auth failures surface as problem+json (Criteria 6, 16)", () => {
  it("invalid token → 401, no internal detail leaked", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed for kid=abc");
      }),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.statusCode).toBe(401);
    expect(res.json().type).toContain("invalid-token");
    expect(JSON.stringify(res.json())).not.toContain("kid=abc");
  });

  it("JWKS unavailable → 503 auth-unavailable", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new AuthUnavailableError("jwks endpoint timed out");
      }),
    });
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    expect(res.statusCode).toBe(503);
    expect(res.json().type).toContain("auth-unavailable");
  });
});

describe("GET /v1/_authcheck (Criterion 12)", () => {
  it("echoes non-sensitive claims and does NOT provision", async () => {
    const repo = new FakeUserRepository();
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() =>
        authContext({
          authSub: "clients|m2m",
          email: undefined,
          emailVerified: undefined,
        }),
      ),
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/_authcheck",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sub: "clients|m2m",
      aud: "https://api.strengthinnumbers.app",
    });
    expect(repo.provisionCalls).toBe(0);
  });

  it("still 401s with no token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/_authcheck" });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/me (Criterion 10)", () => {
  const setup = async () => {
    const repo = new FakeUserRepository([makeUser({ authSub: "auth0|p" })]);
    const { app } = await buildTestApp({
      userRepository: repo,
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|p" })),
    });
    return { app, repo };
  };

  it("updates the row, advances updated_at, omits isNewUser", async () => {
    const { app, repo } = await setup();
    const before = (await repo.findByAuthSub("auth0|p"))!.updatedAt.getTime();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: {
        displayName: "Carol",
        unitPreference: "lb",
        timezone: "America/Chicago",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      displayName: "Carol",
      unitPreference: "lb",
      timezone: "America/Chicago",
    });
    expect(res.json().isNewUser).toBeUndefined();
    const after = (await repo.findByAuthSub("auth0|p"))!.updatedAt.getTime();
    expect(after).toBeGreaterThan(before);
  });

  it("unknown field → 422 with populated errors[]", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { nickname: "x" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it("bad unitPreference → 422", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { unitPreference: "stone" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("invalid IANA timezone → 422 naming timezone", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { timezone: "Mars/Phobos" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].path).toBe("timezone");
  });

  it("displayName over 80 chars → 422", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: JSON_HEADERS,
      payload: { displayName: "z".repeat(81) },
    });
    expect(res.statusCode).toBe(422);
  });
});
