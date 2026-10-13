import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { AccountDeletedResponseSchema, ACCOUNT_PURGE_GRACE_DAYS } from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS, limitsWith } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

describe("AC13 — DELETE /v1/account contract", () => {
  it("401 without a token", async () => {
    const { app } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    expect((await app.inject({ method: "DELETE", url: "/v1/account" })).statusCode).toBe(401);
  });
});

describe("AC14 — 202 body", () => {
  it("returns deletedAt and purgeEligibleAt = deletedAt + 30 days exactly", async () => {
    const { app, repo } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    const res = await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER });
    expect(res.statusCode).toBe(202);
    const body = AccountDeletedResponseSchema.parse(res.json());
    const stored = (await repo.findByAuthSub("auth0|user-123"))!.deletedAt!;
    expect(body.deletedAt).toBe(stored.toISOString());
    expect(Date.parse(body.purgeEligibleAt) - Date.parse(body.deletedAt)).toBe(ACCOUNT_PURGE_GRACE_DAYS * 86_400_000);
  });
});

describe("AC16 / AC17 — lockout and repeat delete", () => {
  it("after the 202, /v1/me and a second DELETE are 403 account-deleted; deleted_at unchanged", async () => {
    const { app, repo } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER });
    const first = (await repo.findByAuthSub("auth0|user-123"))!.deletedAt;
    for (const [method, url] of [["GET", "/v1/me"], ["DELETE", "/v1/account"]] as const) {
      const res = await app.inject({ method, url, headers: BEARER });
      expect(res.statusCode).toBe(403);
      expect(res.json().type).toMatch(/account-deleted$/);
    }
    expect((await repo.findByAuthSub("auth0|user-123"))!.deletedAt).toEqual(first);
  });

  it("a delete that loses the race (markDeleted → null) is 403 account-deleted, never 500", async () => {
    const { app, repo } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    await app.inject({ method: "GET", url: "/v1/me", headers: BEARER }); // provision
    repo.markDeleted = async () => null;
    const res = await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toMatch(/account-deleted$/);
  });
});

describe("AC18 — delete logging", () => {
  it("one account_deleted line with user_id only; no email, sub or token anywhere", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger, rateLimits: GENEROUS_LIMITS });
    await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER });
    const hits = lines.filter((l) => l.msg === "account_deleted");
    expect(hits).toHaveLength(1);
    expect(typeof hits[0]!.user_id).toBe("string");
    expect(JSON.stringify(lines)).not.toMatch(/a@b\.com|auth0\|user-123|test-token/);
  });
});

describe("AC19 — DELETE shares the me write group", () => {
  it("two PATCH /v1/me exhaust a me budget of 2; the DELETE then 429s", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ groups: { me: 2 } }) });
    const json = { ...BEARER, "content-type": "application/json" };
    expect((await app.inject({ method: "PATCH", url: "/v1/me", headers: json, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: "/v1/me", headers: json, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER })).statusCode).toBe(429);
  });

  it("is per user: another user's DELETE is unaffected", async () => {
    const { app } = await buildTestApp({
      rateLimits: limitsWith({ groups: { me: 1 } }),
      tokenVerifier: fakeVerifier((t) => authContext({ authSub: `auth0|${t}`, email: `${t}@ex.com` })),
    });
    expect((await app.inject({ method: "DELETE", url: "/v1/account", headers: { authorization: "Bearer a" } })).statusCode).toBe(202);
    expect((await app.inject({ method: "DELETE", url: "/v1/account", headers: { authorization: "Bearer b" } })).statusCode).toBe(202);
  });
});
