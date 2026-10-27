import { describe, expect, it } from "vitest";
import { CORS_METHODS } from "../../src/plugins/cors-methods.js";
import { limitsWith } from "../helpers/build-test-app.js";
import { AS_A, AS_B, buildHevyApp } from "../helpers/hevy-users.js";

const WORKOUT = "0192a1b2-0000-7000-8000-000000000001";
const ROUTES: [string, string][] = [
  ["GET", "/v1/hevy/status"],
  ["GET", "/v1/hevy/mapping"],
  ["PUT", "/v1/hevy/mapping"],
  ["PATCH", "/v1/hevy/mapping"],
  ["GET", `/v1/workouts/${WORKOUT}/hevy-link`],
  ["POST", `/v1/workouts/${WORKOUT}/hevy-link`],
  ["PUT", `/v1/workouts/${WORKOUT}/hevy-link`],
  ["DELETE", `/v1/workouts/${WORKOUT}/hevy-link`],
];

/** The problem body minus the fields that carry the URL or the request. */
function normalized(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  delete parsed.instance;
  delete parsed.requestId;
  return parsed;
}

describe("19.0 AC17 — the gate", () => {
  it.each(ROUTES)("%s %s for a user not on the list is the unknown-route 404", async (method, url) => {
    const { app } = await buildHevyApp();
    const gated = await app.inject({ method: method as "GET", url, headers: AS_B, payload: method === "GET" || method === "DELETE" ? undefined : {} });
    const unknown = await app.inject({ method: method as "GET", url: `/v1/hevy/nope-${method.toLowerCase()}`, headers: AS_B, payload: method === "GET" || method === "DELETE" ? undefined : {} });
    expect(gated.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(normalized(gated.body)).toEqual(normalized(unknown.body));
  });

  it("Review Focus 1: a 2 MB body, malformed JSON and the 61st call in a minute are still 404", async () => {
    const { app } = await buildHevyApp({ rateLimits: limitsWith({ groups: { hevy: 60 } }) });
    const big = await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: { ...AS_B, "content-type": "application/json" }, payload: `{"pairs":"${"x".repeat(2 * 1024 * 1024)}"}` });
    expect(big.statusCode).toBe(404);
    const bad = await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: { ...AS_B, "content-type": "application/json" }, payload: "{" });
    expect(bad.statusCode).toBe(404);
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: AS_B, payload: { pairs: [], sectionRules: [] } })).statusCode;
    }
    expect(last).toBe(404);
  });

  it("a deleted account gets 403 account-deleted first", async () => {
    const { app } = await buildHevyApp({ deletedA: true });
    const res = await app.inject({ method: "GET", url: "/v1/hevy/status", headers: AS_A });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: expect.stringContaining("account-deleted") });
  });

  it("no Hevy route is in the published API document", async () => {
    const { app } = await buildHevyApp();
    await app.ready();
    const paths = Object.keys((app.swagger() as { paths?: Record<string, unknown> }).paths ?? {});
    expect(paths.filter((p) => p.includes("hevy"))).toEqual([]);
  });
});

describe("19.0 AC32 — the hevy write group and CORS", () => {
  it("a third DELETE …/hevy-link under a limit of 2 is 429 with Retry-After", async () => {
    const { app } = await buildHevyApp({ rateLimits: limitsWith({ groups: { hevy: 2 } }) });
    const url = `/v1/workouts/${WORKOUT}/hevy-link`;
    expect((await app.inject({ method: "DELETE", url, headers: AS_A })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url, headers: AS_A })).statusCode).toBe(204);
    const third = await app.inject({ method: "DELETE", url, headers: AS_A });
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
  });

  it("every Hevy route's method is a CORS method", () => {
    expect(ROUTES.map(([m]) => m).every((m) => CORS_METHODS.includes(m))).toBe(true);
  });
});
