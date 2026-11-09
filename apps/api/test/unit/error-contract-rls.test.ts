// apps/api/test/unit/error-contract-rls.test.ts
import { Prisma } from "@prisma/client";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { registerErrorContract } from "../../src/errors/contract.js";

/**
 * Spec 21.1 §9 — a `42501` from the database (a missing grant, or a policy refusing a row) gets its own log line, so a
 * rollout step or a bug shows up by name. The client still gets the generic 500.
 */

const raw = (code: string, message: string) => new Prisma.PrismaClientKnownRequestError("x", { code: "P2010", clientVersion: "test", meta: { code, message } });

function appThrowing(err: Error, lines: Record<string, unknown>[]) {
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  const app = Fastify({ loggerInstance: logger });
  registerErrorContract(app);
  app.get("/v1/things/:id", { schema: { hide: true } }, async () => {
    throw err;
  });
  return app;
}

async function run(err: Error) {
  const lines: Record<string, unknown>[] = [];
  const res = await appThrowing(err, lines).inject({ method: "GET", url: "/v1/things/abc" });
  return { res, lines };
}

const PINO_ERROR = 50;

describe("Spec 21.1 §9 — rls_violation", () => {
  it("a missing grant: one rls_violation line with the table and the route, and the generic 500 problem", async () => {
    const { res, lines } = await run(raw("42501", "permission denied for table workout"));
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ status: 500 });
    expect(res.body).not.toContain("workout");
    const hits = lines.filter((l) => l.msg === "rls_violation");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ level: PINO_ERROR, sqlstate: "42501", table: "workout", route: "/v1/things/:id" });
    expect(typeof hits[0]!.request_id).toBe("string");
    expect(lines.some((l) => l.msg === "request error")).toBe(false);
  });

  it("a policy refusal names its quoted table too", async () => {
    const { lines } = await run(raw("42501", 'new row violates row-level security policy for table "set_entry"'));
    expect(lines.find((l) => l.msg === "rls_violation")).toMatchObject({ table: "set_entry" });
  });

  it("a 42501 with no table in its message logs table null", async () => {
    const { lines } = await run(raw("42501", "permission denied for schema public"));
    expect(lines.find((l) => l.msg === "rls_violation")).toMatchObject({ table: null, sqlstate: "42501" });
  });

  it("it is found through a cause chain", async () => {
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: raw("42501", "permission denied for table routine") }) });
    const { lines } = await run(wrapped);
    expect(lines.find((l) => l.msg === "rls_violation")).toMatchObject({ table: "routine" });
  });

  it("the chain walk stops at 5 deep (and a cycle cannot hang it)", async () => {
    let deep: Error = raw("42501", "permission denied for table routine");
    for (let i = 0; i < 6; i += 1) deep = new Error(`level ${i}`, { cause: deep });
    const { lines } = await run(deep);
    expect(lines.some((l) => l.msg === "rls_violation")).toBe(false);
    expect(lines.some((l) => l.msg === "request error")).toBe(true);

    const a = new Error("a") as Error & { cause?: unknown };
    a.cause = a;
    const looped = await run(a);
    expect(looped.res.statusCode).toBe(500);
  });

  it("any other database error stays a plain request error", async () => {
    const { lines } = await run(raw("23505", "Key (id)=(1) already exists."));
    expect(lines.some((l) => l.msg === "rls_violation")).toBe(false);
    expect(lines.some((l) => l.msg === "request error")).toBe(true);
  });
});
