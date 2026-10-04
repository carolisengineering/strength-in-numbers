import Fastify from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../../src/errors/app-error.js";
import { registerErrorContract } from "../../src/errors/contract.js";

function appThrowing(err: Error, lines: Record<string, unknown>[]) {
  const app = Fastify({ loggerInstance: pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) }) });
  registerErrorContract(app);
  app.get("/x", { schema: { hide: true } }, async () => {
    throw err;
  });
  return app;
}

describe("AC9 — RateLimitedError renders a 429 problem with Retry-After", () => {
  it("clamps retryAfterSeconds to an integer >= 1", () => {
    expect(new RateLimitedError(0).retryAfterSeconds).toBe(1);
    expect(new RateLimitedError(2.2).retryAfterSeconds).toBe(3);
    expect(new RateLimitedError().retryAfterSeconds).toBe(1);
  });
  it("body: rate-limited type, 429, generic detail naming the delay, instance; Retry-After header", async () => {
    const lines: Record<string, unknown>[] = [];
    const app = appThrowing(new RateLimitedError(17, { layer: "user-rate", group: "sets" }), lines);
    const res = await app.inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(429);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["retry-after"]).toBe("17");
    const body = res.json();
    expect(body.type).toBe("https://strengthinnumbers.app/problems/rate-limited");
    expect(body.title).toBe("Too many requests");
    expect(body.detail).toBe("Too many requests — retry after 17 seconds.");
    expect(typeof body.instance).toBe("string");
    expect(body.instance.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/sets|user-rate/);
  });
});

describe("AC16 — a rejection logs one warn rate_limited line, not the generic error line", () => {
  it("logs layer + group at warn", async () => {
    const lines: Record<string, unknown>[] = [];
    const app = appThrowing(new RateLimitedError(5, { layer: "user-rate", group: "sets" }), lines);
    await app.inject({ method: "GET", url: "/x" });
    const hits = lines.filter((l) => l.msg === "rate_limited");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ level: 40, layer: "user-rate", group: "sets" });
    expect(lines.some((l) => l.msg === "request error")).toBe(false);
  });
});
