import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { server } from "../test/msw/server";
import { createApiClient, type AppEnv } from "./client";
import { ApiError } from "./problem";

const BASE_URL = "https://api.test";

let getToken: ReturnType<typeof vi.fn>;
let onAuthLost: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getToken = vi.fn().mockResolvedValue("tok-abc");
  onAuthLost = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeClient = (appEnv: AppEnv = "staging") =>
  createApiClient({ baseUrl: BASE_URL, appEnv, getToken, onAuthLost });

const problemResponse = (problem: Record<string, unknown>, status: number) =>
  new HttpResponse(JSON.stringify(problem), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

const VALIDATION_PROBLEM = {
  type: "https://strengthinnumbers.app/problems/validation-error",
  title: "Validation error",
  status: 422,
  detail: "The request body failed validation.",
  instance: "server-req-id",
  errors: [{ path: "displayName", message: "must be at most 80 characters" }],
};

describe("request plumbing", () => {
  it("sends Authorization, Accept and a fresh X-Request-Id", async () => {
    let seen: Headers | undefined;
    server.use(
      http.get(`${BASE_URL}/v1/me`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({ id: "u_1" }, { status: 200 });
      }),
    );

    await makeClient().get("/v1/me");

    expect(seen?.get("authorization")).toBe("Bearer tok-abc");
    expect(seen?.get("accept")).toBe("application/json");
    expect(seen?.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("JSON-serialises a patch body with Content-Type: application/json", async () => {
    let contentType: string | null = null;
    let body: unknown;
    server.use(
      http.patch(`${BASE_URL}/v1/me`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.json();
        return HttpResponse.json({ id: "u_1" }, { status: 200 });
      }),
    );

    await makeClient().patch("/v1/me", { displayName: "Sam" });

    expect(contentType).toBe("application/json");
    expect(body).toEqual({ displayName: "Sam" });
  });

  it("parses a 2xx body through the supplied schema", async () => {
    const Me = z.object({ id: z.string() });
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        HttpResponse.json({ id: "u_1", extra: 9 }, { status: 200 }),
      ),
    );

    await expect(makeClient().get("/v1/me", Me)).resolves.toEqual({ id: "u_1" });
  });

  it("returns the raw body when no schema is supplied", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        HttpResponse.json({ id: "u_1", extra: 9 }, { status: 200 }),
      ),
    );

    await expect(makeClient().get("/v1/me")).resolves.toEqual({
      id: "u_1",
      extra: 9,
    });
  });

  it("resolves undefined for a 204 response", async () => {
    server.use(
      http.delete(
        `${BASE_URL}/v1/thing/1`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    await expect(makeClient().delete("/v1/thing/1")).resolves.toBeUndefined();
  });

  it("throws a Malformed response ApiError on non-JSON 2xx", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        HttpResponse.text("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(makeClient().get("/v1/me")).rejects.toMatchObject({
      name: "ApiError",
      title: "Malformed response",
    });
  });
});

describe("AC11 — typed errors from problem+json", () => {
  it("maps an application/problem+json response to a fully populated ApiError", async () => {
    let sentRequestId: string | null = null;
    server.use(
      http.get(`${BASE_URL}/v1/me`, ({ request }) => {
        sentRequestId = request.headers.get("x-request-id");
        return problemResponse(VALIDATION_PROBLEM, 422);
      }),
    );

    const error: unknown = await makeClient()
      .get("/v1/me")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.type).toBe("validation-error");
    expect(apiError.title).toBe("Validation error");
    expect(apiError.detail).toBe("The request body failed validation.");
    expect(apiError.errors).toEqual([
      { path: "displayName", message: "must be at most 80 characters" },
    ]);
    expect(apiError.instance).toBe("server-req-id");
    expect(apiError.isNetworkError).toBe(false);
    expect(apiError.isValidation()).toBe(true);
    expect(apiError.requestId).toBe(sentRequestId);
    expect(apiError.requestId).toMatch(/[0-9a-f-]{36}/i);
  });

  it("maps a dropped connection to a network ApiError (status 0, about:blank)", async () => {
    server.use(http.get(`${BASE_URL}/v1/ping`, () => HttpResponse.error()));

    const error: unknown = await makeClient()
      .get("/v1/ping")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.isNetworkError).toBe(true);
    expect(apiError.status).toBe(0);
    expect(apiError.type).toBe("about:blank");
    expect(apiError.requestId).toMatch(/[0-9a-f-]{36}/i);
  });

  it("keeps the transport status when a non-2xx body is not problem+json", async () => {
    server.use(
      http.get(`${BASE_URL}/down`, () =>
        HttpResponse.text("<html>502</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const error = (await makeClient()
      .get("/down")
      .catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.type).toBe("about:blank");
    expect(error.isNetworkError).toBe(false);
  });

  it("degrades a JSON error body that is not problem-shaped", async () => {
    server.use(
      http.get(`${BASE_URL}/oops`, () =>
        HttpResponse.json({ nope: true }, { status: 500 }),
      ),
    );

    const error = (await makeClient()
      .get("/oops")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(500);
    expect(error.type).toBe("about:blank");
  });

  it("exposes isUnavailable() for a 503 auth-unavailable problem", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        problemResponse(
          {
            type: "https://strengthinnumbers.app/problems/auth-unavailable",
            title: "Authentication temporarily unavailable",
            status: 503,
            detail: "Unable to validate credentials right now.",
            instance: "rid",
          },
          503,
        ),
      ),
    );

    const error = (await makeClient()
      .get("/v1/me")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.isUnavailable()).toBe(true);
    expect(error.type).toBe("auth-unavailable");
  });
});

describe("AC12 — 401 triggers exactly one silent retry", () => {
  it("refreshes the token once and retries when the first attempt is 401", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/v1/me`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({ id: "u_1" }, { status: 200 });
      }),
    );
    getToken
      .mockReset()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");

    const body = await makeClient().get("/v1/me");

    expect(body).toEqual({ id: "u_1" });
    expect(calls).toBe(2);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getToken).toHaveBeenNthCalledWith(2, { ignoreCache: true });
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it("calls onAuthLost once and throws when the retry is also 401", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/v1/me`, () => {
        calls += 1;
        return problemResponse(
          {
            type: "https://strengthinnumbers.app/problems/unauthenticated",
            title: "Unauthenticated",
            status: 401,
            detail: "Authentication is required to access this resource.",
            instance: "rid",
          },
          401,
        );
      }),
    );

    const error = (await makeClient()
      .get("/v1/me")
      .catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.type).toBe("unauthenticated");
    expect(calls).toBe(2);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(2, { ignoreCache: true });
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });

  it("treats a getToken rejection as a lost session (onAuthLost + status-0 ApiError)", async () => {
    getToken.mockReset().mockRejectedValue(new Error("missing_refresh_token"));

    const error = (await makeClient()
      .get("/v1/me")
      .catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.isNetworkError).toBe(false);
    expect(error.type).toBe("about:blank");
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });
});

describe("Q15 — response validation is dev-hard, prod-warn", () => {
  const Me = z.object({ id: z.string() });

  it("throws on a schema mismatch when appEnv is not production", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        HttpResponse.json({ wrong: true }, { status: 200 }),
      ),
    );

    await expect(makeClient("staging").get("/v1/me", Me)).rejects.toThrow(
      /expected string/i,
    );
  });

  it("console.warns and passes the raw body through when appEnv is production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(
      http.get(`${BASE_URL}/v1/me`, () =>
        HttpResponse.json({ wrong: true }, { status: 200 }),
      ),
    );

    const body = await makeClient("production").get("/v1/me", Me);

    expect(body).toEqual({ wrong: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
