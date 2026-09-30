import { describe, it, expect } from "vitest";
import { createLogger } from "../../src/logging.js";
import { buildTestApp, testConfig } from "../helpers/build-test-app.js";
import { FakeUserRepository, authContext } from "../helpers/fakes.js";
import type { UserRecord } from "../../src/repositories/user.js";

/**
 * Issue #7 / Spec 01 §7: `email` / `display_name` must never reach a log line.
 * Every test here logs through the *real* logger config (`createLogger`) into
 * a capture stream and asserts the PII string is absent from the raw output —
 * not just from one field — so a leak via a message, a stack, or a nested key
 * all fail the same way.
 */

const EMAIL = "leak-probe@example.com";
const NAME = "Leak Probe";

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger(testConfig(), { write: (s: string) => lines.push(s) });
  return { lines, logger };
}

/** Mimics `@prisma/client`'s error classes without importing the generated client. */
class PrismaClientKnownRequestError extends Error {
  code: string;
  meta: Record<string, unknown>;
  clientVersion = "6.19.3";
  constructor(message: string, code: string, meta: Record<string, unknown>) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
    this.meta = meta;
  }
}

class PrismaClientValidationError extends Error {
  clientVersion = "6.19.3";
  constructor(message: string) {
    super(message);
    this.name = "PrismaClientValidationError";
  }
}

describe("createLogger — PII redaction (#7)", () => {
  it("drops `meta` from a Prisma known-request error logged via { err }", () => {
    const { lines, logger } = capture();
    const err = new PrismaClientKnownRequestError("Unique constraint failed", "P2002", {
      target: ["email"],
      email: EMAIL,
    });
    logger.error({ err }, "request error");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    // The parts that help debugging survive.
    expect(out).toContain("PrismaClientKnownRequestError");
    expect(out).toContain("P2002");
  });

  it("redacts a Prisma validation error whose message dumps query arguments", () => {
    const { lines, logger } = capture();
    const err = new PrismaClientValidationError(
      `Invalid \`prisma.user.update()\` invocation:\n{ data: { email: "${EMAIL}", displayName: "${NAME}" } }`,
    );
    logger.error({ err }, "request error");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(NAME);
    expect(out).toContain("PrismaClientValidationError");
  });

  it("redacts a Prisma error that is the `cause` of one of our own errors", () => {
    const { lines, logger } = capture();
    const inner = new PrismaClientValidationError(`Argument email: "${EMAIL}"`);
    const err = new Error("profile update failed", { cause: inner });
    logger.error({ err }, "request error");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).toContain("profile update failed");
  });

  it("redacts a Prisma error inside an AggregateError's `errors`", () => {
    const { lines, logger } = capture();
    const inner = new PrismaClientValidationError(`Argument email: "${EMAIL}"`);
    const err = new AggregateError([inner, new Error("other")], "all failed");
    logger.error({ err }, "request error");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).toContain("all failed");
    expect(out).toContain("other");
  });

  it("fails closed on an over-deep cause chain rather than logging it unscrubbed", () => {
    const { lines, logger } = capture();
    let err: Error = new PrismaClientValidationError(`Argument email: "${EMAIL}"`);
    for (let i = 0; i < 12; i++) err = new Error(`wrap ${i}`, { cause: err });
    logger.error({ err }, "request error");
    expect(lines.join("")).not.toContain(EMAIL);
  });

  it("redacts top-level email / displayName / claims keys (e.g. `log.info(request.auth)`)", () => {
    const { lines, logger } = capture();
    const ns = testConfig().auth0.claimNamespace;
    logger.info(
      authContext({ email: EMAIL, claims: { sub: "auth0|1", [`${ns}email`]: EMAIL } }),
      "auth spread at top level",
    );
    logger.info({ displayName: NAME, display_name: NAME, id: "u1" }, "profile");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(NAME);
    expect(out).toContain('"id":"u1"');
  });

  it("still logs message and stack for an ordinary error (control)", () => {
    const { lines, logger } = capture();
    logger.error({ err: new Error("connect ECONNREFUSED db:5432") }, "request error");
    const out = lines.join("");
    expect(out).toContain("connect ECONNREFUSED db:5432");
    expect(out).toMatch(/"stack":"Error: connect ECONNREFUSED/);
  });

  it("redacts email / displayName keys three levels deep", () => {
    const { lines, logger } = capture();
    logger.info({ ctx: { user: { email: EMAIL, displayName: NAME, id: "u1" } } }, "x");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(NAME);
    expect(out).toContain('"id":"u1"');
  });

  it("redacts a logged auth context's raw `claims` and the namespaced claim keys", () => {
    const { lines, logger } = capture();
    const ns = testConfig().auth0.claimNamespace;
    const auth = authContext({
      email: EMAIL,
      claims: { sub: "auth0|1", [`${ns}email`]: EMAIL },
    });
    logger.info({ auth }, "auth");
    logger.info({ [`${ns}email`]: EMAIL, sub: "auth0|1" }, "top-level claim key");
    logger.info({ token: { [`${ns}email`]: EMAIL } }, "nested claim key");
    const out = lines.join("");
    expect(out).not.toContain(EMAIL);
    expect(out).toContain("auth0|1");
  });

  it("redacts request headers if a request object is ever logged in full", () => {
    const { lines, logger } = capture();
    logger.info(
      { req: { method: "GET", headers: { authorization: "Bearer secret", "x-user-email": EMAIL } } },
      "req",
    );
    const out = lines.join("");
    expect(out).not.toContain("Bearer secret");
    expect(out).not.toContain(EMAIL);
  });
});

describe("error handler + real logger — end to end (#7)", () => {
  class ThrowingUserRepository extends FakeUserRepository {
    override async updateProfile(): Promise<UserRecord> {
      throw new PrismaClientValidationError(
        `Invalid \`prisma.user.update()\` invocation:\n{ data: { displayName: "${NAME}", email: "${EMAIL}" } }`,
      );
    }
  }

  it("a Prisma error thrown by a route is logged without the PII in its message", async () => {
    const { lines, logger } = capture();
    const { app } = await buildTestApp({
      logger,
      userRepository: new ThrowingUserRepository(),
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      payload: { displayName: NAME },
    });
    expect(res.statusCode).toBe(500);
    const out = lines.join("");
    expect(out).toContain("request error");
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(NAME);
  });
});
