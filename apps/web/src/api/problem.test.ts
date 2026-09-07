import { describe, expect, it } from "vitest";

import { ApiError, parseProblem, slugFromType } from "./problem";

describe("parseProblem", () => {
  it("maps a full RFC 9457 body, keeping value-free errors[]", () => {
    const problem = parseProblem(
      {
        type: "https://strengthinnumbers.app/problems/validation-error",
        title: "Validation error",
        status: 422,
        detail: "The request body failed validation.",
        instance: "req-abc",
        errors: [{ path: "displayName", message: "must be at most 80 characters" }],
      },
      500,
    );
    expect(problem).toEqual({
      type: "https://strengthinnumbers.app/problems/validation-error",
      title: "Validation error",
      status: 422,
      detail: "The request body failed validation.",
      instance: "req-abc",
      errors: [{ path: "displayName", message: "must be at most 80 characters" }],
    });
  });

  it("drops malformed errors[] entries and falls back to the transport status", () => {
    const problem = parseProblem(
      { title: "Nope", errors: [{ path: "a" }, "x", { path: "b", message: "bad" }] },
      503,
    );
    expect(problem?.status).toBe(503);
    expect(problem?.errors).toEqual([{ path: "b", message: "bad" }]);
    expect(problem?.type).toBe("about:blank");
  });

  it("returns null for non-object or non-problem-shaped bodies", () => {
    expect(parseProblem("boom", 500)).toBeNull();
    expect(parseProblem(null, 500)).toBeNull();
    expect(parseProblem({ hello: "world" }, 500)).toBeNull();
  });
});

describe("slugFromType", () => {
  it("takes the last path segment of a problem type URL", () => {
    expect(
      slugFromType("https://strengthinnumbers.app/problems/invalid-token"),
    ).toBe("invalid-token");
  });

  it("maps empty / about:blank to about:blank", () => {
    expect(slugFromType("")).toBe("about:blank");
    expect(slugFromType("about:blank")).toBe("about:blank");
  });

  it("tolerates a bare slug and trailing query/fragment", () => {
    expect(slugFromType("not-found")).toBe("not-found");
    expect(slugFromType("https://x.test/problems/internal?ref=1")).toBe("internal");
  });
});

describe("ApiError", () => {
  it("stores the slug on .type and the raw value on .typeUrl", () => {
    const error = ApiError.fromProblem(
      {
        type: "https://strengthinnumbers.app/problems/auth-unavailable",
        title: "Authentication temporarily unavailable",
        status: 503,
        detail: "Retry shortly.",
        instance: "rid",
        errors: [],
      },
      "rid",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.type).toBe("auth-unavailable");
    expect(error.typeUrl).toBe(
      "https://strengthinnumbers.app/problems/auth-unavailable",
    );
    expect(error.isUnavailable()).toBe(true);
    expect(error.isValidation()).toBe(false);
    expect(error.isUnauthenticated()).toBe(false);
  });

  it("network() is a status-0 about:blank error flagged isNetworkError", () => {
    const error = ApiError.network("rid", new TypeError("Failed to fetch"));
    expect(error.status).toBe(0);
    expect(error.type).toBe("about:blank");
    expect(error.isNetworkError).toBe(true);
    expect(error.requestId).toBe("rid");
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});
