import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { registerRateLimits, WRITE_GROUPS, type WriteGroup } from "../../src/plugins/rate-limit.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { buildTestApp, GENEROUS_LIMITS, limitsWith } from "../helpers/build-test-app.js";

const A = { authorization: "Bearer token-a" };
const B = { authorization: "Bearer token-b" };
const verifier = fakeVerifier((t) => authContext({ authSub: `auth0|${t}`, email: `${t}@ex.com` }));
const ID = "00000000-0000-7000-8000-000000000001";

/** Spec 05.2 §6.2 — every /v1 write route and its group. */
const ROUTES: [WriteGroup, "POST" | "PATCH" | "DELETE", string][] = [
  ["sets", "POST", `/v1/workout-exercises/${ID}/sets`],
  ["sets", "PATCH", `/v1/sets/${ID}`],
  ["sets", "DELETE", `/v1/sets/${ID}`],
  ["workouts", "POST", "/v1/workouts"],
  ["workouts", "PATCH", `/v1/workouts/${ID}`],
  ["workouts", "DELETE", `/v1/workouts/${ID}`],
  ["workouts", "POST", `/v1/workouts/${ID}/exercises`],
  ["workouts", "PATCH", `/v1/workout-exercises/${ID}`],
  ["workouts", "DELETE", `/v1/workout-exercises/${ID}`],
  ["exercises", "POST", "/v1/exercises"],
  ["exercises", "PATCH", `/v1/exercises/${ID}`],
  ["exercises", "POST", `/v1/exercises/${ID}/fork`],
  ["exercises", "DELETE", `/v1/exercises/${ID}`],
  ["me", "PATCH", "/v1/me"],
];
const call = (method: string, url: string, headers: Record<string, string> = A) => ({
  method: method as "POST",
  url,
  headers: { ...headers, "content-type": "application/json" },
  payload: "{}",
});

describe("§6.1 — every write route is in its §6.2 group", () => {
  it.each(WRITE_GROUPS)("with only %s at 0, exactly that group's routes are 429", async (group) => {
    const { app } = await buildTestApp({ tokenVerifier: verifier, rateLimits: limitsWith({ groups: { [group]: 0 } }) });
    for (const [g, method, url] of ROUTES) {
      const res = await app.inject(call(method, url));
      if (g === group) expect(res.statusCode, `${method} ${url}`).toBe(429);
      else expect(res.statusCode, `${method} ${url}`).not.toBe(429);
    }
  });
});

describe("§6.1 — app assembly fails for a misdeclared route", () => {
  async function scope(register: (v1: FastifyInstance) => void) {
    const app = Fastify();
    const limits = await registerRateLimits(app, GENEROUS_LIMITS, { isProduction: false });
    await app.register(async (v1) => {
      limits.attachWriteLimits(v1);
      register(v1);
    });
    return app.ready();
  }
  it("a write route with no writeGroup", async () => {
    await expect(scope((v1) => v1.post("/x", { schema: { hide: true } }, async () => ({})))).rejects.toThrow(
      /writeGroup/,
    );
  });
  it("a GET route with a writeGroup", async () => {
    await expect(
      scope((v1) => v1.get("/x", { schema: { hide: true }, config: { writeGroup: "sets" } }, async () => ({}))),
    ).rejects.toThrow(/writeGroup/);
  });
});

describe("AC3 — routes in one group share one counter", () => {
  it("POST then PATCH then DELETE on sets with sets=2 → the third is 429", async () => {
    const { app } = await buildTestApp({ tokenVerifier: verifier, rateLimits: limitsWith({ groups: { sets: 2 } }) });
    expect((await app.inject(call("POST", ROUTES[0]![2]))).statusCode).not.toBe(429);
    expect((await app.inject(call("PATCH", ROUTES[1]![2]))).statusCode).not.toBe(429);
    expect((await app.inject(call("DELETE", ROUTES[2]![2]))).statusCode).toBe(429);
  });
});

describe("AC4 — groups and users are isolated", () => {
  it("exhausting exercises leaves the same user's sets usable and user B's exercises usable", async () => {
    const { app } = await buildTestApp({ tokenVerifier: verifier, rateLimits: limitsWith({ groups: { exercises: 1 } }) });
    await app.inject(call("POST", "/v1/exercises"));
    expect((await app.inject(call("POST", "/v1/exercises"))).statusCode).toBe(429);
    expect((await app.inject(call("PATCH", `/v1/sets/${ID}`))).statusCode).not.toBe(429);
    expect((await app.inject(call("POST", "/v1/exercises", B))).statusCode).not.toBe(429);
  });
});

describe("AC5 — reads carry no per-user limit", () => {
  it("every write group at 0, GET still 200", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: verifier,
      rateLimits: limitsWith({ groups: { sets: 0, workouts: 0, exercises: 0, me: 0 } }),
    });
    expect((await app.inject(call("PATCH", "/v1/me"))).statusCode).toBe(429);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: A })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/exercises", headers: A })).statusCode).toBe(200);
  });
});

describe("AC12 — an L2 429 exposes Retry-After to the browser", () => {
  it("cross-origin 429 carries ACAO + Access-Control-Expose-Headers with Retry-After", async () => {
    const { app } = await buildTestApp({ tokenVerifier: verifier, rateLimits: limitsWith({ groups: { me: 0 } }) });
    const res = await app.inject(call("PATCH", "/v1/me", { ...A, origin: "http://localhost:5173" }));
    expect(res.statusCode).toBe(429);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain("retry-after");
  });
});

describe("AC16 — L2 rejection log names the user and group", () => {
  it("warn rate_limited layer user-rate, group, userId; no ip", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const { app } = await buildTestApp({ logger, tokenVerifier: verifier, rateLimits: limitsWith({ groups: { me: 0 } }) });
    await app.inject(call("PATCH", "/v1/me"));
    const hit = lines.find((l) => l.msg === "rate_limited");
    expect(hit).toMatchObject({ level: 40, layer: "user-rate", group: "me" });
    expect(typeof hit?.userId).toBe("string");
    expect(hit).not.toHaveProperty("ip");
  });
});
