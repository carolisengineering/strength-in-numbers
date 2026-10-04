import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { buildTestApp, limitsWith } from "../helpers/build-test-app.js";

const BEARER = { authorization: "Bearer test-token" };
const ORIGIN = "http://localhost:5173";
const me = (remoteAddress: string, headers: Record<string, string> = BEARER) => ({
  method: "GET" as const,
  url: "/v1/me",
  remoteAddress,
  headers,
});
function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return { logger: pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) }), lines };
}

describe("AC1 — L1 per-IP limit", () => {
  it("the request past ip.max in one window is 429; another address is unaffected", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 2 }) });
    expect((await app.inject(me("203.0.113.1"))).statusCode).toBe(200);
    expect((await app.inject(me("203.0.113.1"))).statusCode).toBe(200);
    const third = await app.inject(me("203.0.113.1"));
    expect(third.statusCode).toBe(429);
    expect(third.json().type).toContain("rate-limited");
    expect((await app.inject(me("203.0.113.2"))).statusCode).toBe(200);
  });
  it("unmatched routes count too (scanners)", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    await app.inject({ method: "GET", url: "/nope", remoteAddress: "203.0.113.1" });
    expect((await app.inject({ method: "GET", url: "/nope2", remoteAddress: "203.0.113.1" })).statusCode).toBe(429);
  });
  it("Review focus 1 — addresses in one IPv6 /64 share a bucket", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    await app.inject(me("2001:db8:1:2::a"));
    expect((await app.inject(me("2001:db8:1:2::b"))).statusCode).toBe(429);
    expect((await app.inject(me("2001:db8:1:3::a"))).statusCode).toBe(200);
  });
});

describe("AC2 — L1 runs before auth", () => {
  it("a rejected request (no token, bad token) never reaches the verifier", async () => {
    let calls = 0;
    const { app } = await buildTestApp({
      rateLimits: limitsWith({ ip: 1 }),
      tokenVerifier: fakeVerifier(() => {
        calls += 1;
        return authContext();
      }),
    });
    await app.inject(me("203.0.113.1"));
    expect(calls).toBe(1);
    const noToken = await app.inject(me("203.0.113.1", {}));
    const badToken = await app.inject(me("203.0.113.1", { authorization: "Bearer nope" }));
    expect(noToken.statusCode).toBe(429);
    expect(badToken.statusCode).toBe(429);
    expect(calls).toBe(1);
  });
});

describe("AC6 — health probes and /openapi.json are never limited", () => {
  it("stay 200 past ip.max, from a private address", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    for (const url of ["/healthz", "/readyz", "/openapi.json", "/healthz", "/readyz", "/openapi.json"]) {
      expect((await app.inject({ method: "GET", url, remoteAddress: "10.0.0.9" })).statusCode, url).toBe(200);
    }
  });
});

describe("AC9 — no rate-limit headers except Retry-After on a 429", () => {
  it("200 and 429 carry no X-RateLimit-* / RateLimit-*", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    const ok = await app.inject(me("203.0.113.1"));
    const limited = await app.inject(me("203.0.113.1"));
    expect(limited.statusCode).toBe(429);
    for (const res of [ok, limited]) {
      expect(Object.keys(res.headers).filter((h) => /ratelimit/i.test(h))).toEqual([]);
    }
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(Number(limited.headers["retry-after"]))).toBe(true);
    expect(limited.json().instance).toBeTruthy();
  });
});

describe("AC10 — the limiter fails open", () => {
  it("a throwing store lets requests through and logs rate_limiter_failed", async () => {
    class FailingStore {
      incr(_key: string, cb: (err: Error | null) => void) {
        cb(new Error("store down"));
      }
      child() {
        return this;
      }
    }
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger, rateLimits: limitsWith({ ip: 1, store: FailingStore as never }) });
    for (let i = 0; i < 3; i += 1) expect((await app.inject(me("203.0.113.1"))).statusCode).toBe(200);
    expect(lines.filter((l) => l.msg === "rate_limiter_failed").length).toBeGreaterThanOrEqual(3);
  });
});

describe("AC12 + Review focus 2/3 — CORS on a 429 and on preflights", () => {
  it("an L1 429 to an allowlisted origin carries ACAO and exposes Retry-After", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    const headers = { ...BEARER, origin: ORIGIN };
    await app.inject(me("203.0.113.1", headers));
    const res = await app.inject(me("203.0.113.1", headers));
    expect(res.statusCode).toBe(429);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain("retry-after");
  });
  it("preflights don't spend L1 budget", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    const preflight = {
      method: "OPTIONS" as const,
      url: "/v1/me",
      remoteAddress: "203.0.113.1",
      headers: { origin: ORIGIN, "access-control-request-method": "PATCH" },
    };
    await app.inject(preflight);
    await app.inject(preflight);
    expect((await app.inject(me("203.0.113.1"))).statusCode).toBe(200);
  });
});

describe("AC16 — L1 rejection log names the IP, not a user", () => {
  it("warn rate_limited layer ip with ip, no userId, no token", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger, rateLimits: limitsWith({ ip: 1 }) });
    await app.inject(me("203.0.113.1"));
    await app.inject(me("203.0.113.1"));
    const hit = lines.find((l) => l.msg === "rate_limited");
    expect(hit).toMatchObject({ level: 40, layer: "ip", ip: "203.0.113.1" });
    expect(hit).not.toHaveProperty("userId");
    expect(JSON.stringify(lines)).not.toContain("test-token");
  });
});
