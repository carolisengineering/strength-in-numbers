import { describe, it, expect } from "vitest";
import {
  AppError,
  UnauthenticatedError,
  InvalidTokenError,
  AuthUnavailableError,
  AccountDeletedError,
  ValidationError,
  PayloadTooLargeError,
  NotFoundError,
  InternalError,
} from "../../src/errors/app-error.js";
import { toProblem, PROBLEM_BASE_URL } from "../../src/errors/problem.js";

const INSTANCE = "req-abc-123";

describe("AppError hierarchy", () => {
  it("every subtype carries status + slug + title and is an Error", () => {
    const cases: Array<[AppError, number, string]> = [
      [new UnauthenticatedError(), 401, "unauthenticated"],
      [new InvalidTokenError("expired"), 401, "invalid-token"],
      [new AuthUnavailableError("jwks fetch failed"), 503, "auth-unavailable"],
      [new AccountDeletedError(), 403, "account-deleted"],
      [
        new ValidationError([{ path: "unitPreference", message: "invalid" }]),
        422,
        "validation-error",
      ],
      [new PayloadTooLargeError(), 413, "payload-too-large"],
      [new NotFoundError(), 404, "not-found"],
      [new InternalError("boom"), 500, "internal"],
    ];
    for (const [err, status, slug] of cases) {
      expect(err, slug).toBeInstanceOf(AppError);
      expect(err, slug).toBeInstanceOf(Error);
      expect(err.status, slug).toBe(status);
      expect(err.slug).toBe(slug);
      expect(err.title.length).toBeGreaterThan(0);
    }
  });
});

describe("toProblem", () => {
  it("maps an AppError to an RFC 9457 body with instance = request id", () => {
    const { status, body } = toProblem(new AccountDeletedError(), INSTANCE);
    expect(status).toBe(403);
    expect(body).toMatchObject({
      type: `${PROBLEM_BASE_URL}account-deleted`,
      title: expect.any(String),
      status: 403,
      detail: expect.any(String),
      instance: INSTANCE,
    });
    expect(body.errors).toBeUndefined();
  });

  it("never leaks internal detail on 401 / 403 / 500 / 503", () => {
    const leaky: AppError[] = [
      new InvalidTokenError("signature verification failed for kid=abc123"),
      new AuthUnavailableError("connect ECONNREFUSED 10.0.0.5:443"),
      new AccountDeletedError("user 018f... soft-deleted at ..."),
      new InternalError("TypeError: undefined is not an object at db.ts:42"),
      new UnauthenticatedError("bearer prefix missing"),
    ];
    for (const err of leaky) {
      const { body } = toProblem(err, INSTANCE);
      const blob = JSON.stringify(body);
      expect(blob).not.toMatch(/kid=abc123/);
      expect(blob).not.toMatch(/ECONNREFUSED/);
      expect(blob).not.toMatch(/db\.ts:42/);
      expect(blob).not.toMatch(/soft-deleted/);
      expect(body.detail).not.toContain(err.message);
    }
  });

  it("includes errors[] for a ValidationError, preserving field paths", () => {
    const { status, body } = toProblem(
      new ValidationError([
        { path: "displayName", message: "too long" },
        { path: "timezone", message: "not a valid IANA zone" },
      ]),
      INSTANCE,
    );
    expect(status).toBe(422);
    expect(body.type).toBe(`${PROBLEM_BASE_URL}validation-error`);
    expect(body.errors).toEqual([
      { path: "displayName", message: "too long" },
      { path: "timezone", message: "not a valid IANA zone" },
    ]);
  });

  it("maps a Fastify schema-validation error to validation-error 422", () => {
    const fastifyErr = Object.assign(
      new Error("body/unitPreference must be equal to one of the allowed values"),
      {
        validation: [
          {
            instancePath: "/unitPreference",
            message: "must be equal to one of the allowed values",
          },
        ],
        validationContext: "body",
      },
    );
    const { status, body } = toProblem(fastifyErr, INSTANCE);
    expect(status).toBe(422);
    expect(body.type).toBe(`${PROBLEM_BASE_URL}validation-error`);
    expect(body.errors?.[0]).toEqual({
      path: "unitPreference",
      message: "must be equal to one of the allowed values",
    });
  });

  it("maps a Fastify 404 to not-found", () => {
    const err = Object.assign(new Error("Route GET:/nope not found"), {
      statusCode: 404,
    });
    const { status, body } = toProblem(err, INSTANCE);
    expect(status).toBe(404);
    expect(body.type).toBe(`${PROBLEM_BASE_URL}not-found`);
  });

  it("maps a body-too-large error to payload-too-large 413", () => {
    const err = Object.assign(new Error("Request body is too large"), {
      statusCode: 413,
      code: "FST_ERR_CTP_BODY_TOO_LARGE",
    });
    const { status, body } = toProblem(err, INSTANCE);
    expect(status).toBe(413);
    expect(body.type).toBe(`${PROBLEM_BASE_URL}payload-too-large`);
  });

  it("maps an unknown throwable to internal 500 without leaking the message", () => {
    const { status, body } = toProblem(
      new Error("connect ECONNREFUSED db:5432"),
      INSTANCE,
    );
    expect(status).toBe(500);
    expect(body.type).toBe(`${PROBLEM_BASE_URL}internal`);
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED/);
  });
});
