import { describe, expect, it } from "vitest";
import { buildTestApp, limitsWith, RATE_LIMITS } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";

const tokens = () => fakeVerifier((t) => authContext({ authSub: `auth0|${t}`, email: `${t}@ex.com` }));
const get = (app: Awaited<ReturnType<typeof buildTestApp>>["app"], t: string) =>
  app.inject({ method: "GET", url: "/v1/account/export", headers: { authorization: `Bearer ${t}` } });

describe("AC10 — per-user export budget", () => {
  it("is 3 per window in RATE_LIMITS", () => {
    expect(RATE_LIMITS.exportPerUser).toBe(3);
  });

  it("the 3rd export in a budget of 2 is 429 with Retry-After; another user and other routes are unaffected", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ exportPerUser: 2 }), tokenVerifier: tokens() });
    expect((await get(app, "a")).statusCode).toBe(200);
    expect((await get(app, "a")).statusCode).toBe(200);
    const third = await get(app, "a");
    expect(third.statusCode).toBe(429);
    expect(third.json().type).toMatch(/rate-limited$/);
    expect(Number(third.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((await get(app, "b")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer a" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: "/v1/me", headers: { authorization: "Bearer a", "content-type": "application/json" }, payload: {} })).statusCode).toBe(200);
  });

  it("the L1 per-IP limit still applies to the export", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 2 }), tokenVerifier: tokens() });
    await get(app, "a");
    await get(app, "b");
    expect((await get(app, "c")).statusCode).toBe(429);
  });
});
