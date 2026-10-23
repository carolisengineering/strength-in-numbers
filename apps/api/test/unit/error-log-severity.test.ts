import Fastify, { type FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import {
  AccountDeletedError,
  BadRequestError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  InternalError,
  InvalidTokenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { registerErrorContract } from "../../src/errors/contract.js";

function appThrowing(err: Error, lines: Record<string, unknown>[]) {
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  const app = Fastify({ loggerInstance: logger });
  registerErrorContract(app);
  app.get("/x", { schema: { hide: true } }, async () => {
    throw err;
  });
  return app;
}

const PINO_INFO = 30;
const PINO_WARN = 40;
const PINO_ERROR = 50;

describe("#27 / BL-5 — a client error logs at info (a failed token check at warn); error is for server faults", () => {
  it.each([
    ["404 not-found", new NotFoundError(), 404, "not-found"],
    ["409 exercise-retired", new ExerciseRetiredError(), 409, "exercise-retired"],
    ["409 exercise-immutable-use-fork", new ExerciseImmutableUseForkError(), 409, "exercise-immutable-use-fork"],
    ["422 validation-error", new ValidationError([{ path: "name", message: "required" }]), 422, "validation-error"],
    ["401 unauthenticated (no token)", new UnauthenticatedError(), 401, "unauthenticated"],
    ["403 account-deleted", new AccountDeletedError(), 403, "account-deleted"],
    ["400 bad-request", new BadRequestError(), 400, "bad-request"],
  ])("%s → one info 'request rejected' line with slug and status, no error line", async (_label, err, status, slug) => {
    const lines: Record<string, unknown>[] = [];
    const res = await appThrowing(err, lines).inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(status);
    const rejected = lines.filter((l) => l.msg === "request rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ level: PINO_INFO, slug, status });
    expect(lines.some((l) => l.level === PINO_ERROR)).toBe(false);
  });

  it("401 invalid-token (a token that fails verification) is a warn, so a broken auth setup stands out", async () => {
    const lines: Record<string, unknown>[] = [];
    const res = await appThrowing(new InvalidTokenError("signature check failed"), lines).inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(401);
    const rejected = lines.filter((l) => l.msg === "request rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ level: PINO_WARN, slug: "invalid-token", status: 401 });
    expect(lines.some((l) => l.level === PINO_ERROR)).toBe(false);
  });

  it("the problem sent is the one the level was picked from (a plain Error → one 500 body)", async () => {
    const lines: Record<string, unknown>[] = [];
    const res = await appThrowing(new Error("boom"), lines).inject({ method: "GET", url: "/x" });
    expect(res.json()).toMatchObject({ status: 500, type: expect.stringContaining("internal"), detail: "An unexpected error occurred." });
    expect(res.body).not.toContain("boom");
  });

  it.each([
    ["an InternalError", new InternalError()],
    ["a plain Error", new Error("boom")],
  ])("%s (500) still logs at error as 'request error'", async (_label, err) => {
    const lines: Record<string, unknown>[] = [];
    const res = await appThrowing(err, lines).inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(500);
    const logged = lines.filter((l) => l.msg === "request error");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.level).toBe(PINO_ERROR);
    expect(lines.some((l) => l.msg === "request rejected")).toBe(false);
  });
});
