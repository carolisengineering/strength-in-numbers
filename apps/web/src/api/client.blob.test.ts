import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client";
import { ApiError } from "./problem";

const BASE = "https://api.example.test";
const PATH = "/v1/account/export";

const jsonHeaders = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  "content-disposition": 'attachment; filename="strength-in-numbers-export-2026-10-14.json"',
  ...extra,
});
const problemResponse = (status: number, slug: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: `https://strengthinnumbers.app/problems/${slug}`, title: slug, status, detail: "d", instance: "i" }), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });

let fetchMock: ReturnType<typeof vi.fn>;
let onAuthLost: ReturnType<typeof vi.fn>;
let getToken: ReturnType<typeof vi.fn>;
const make = () => createApiClient({ baseUrl: BASE, appEnv: "staging", getToken, onAuthLost });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  onAuthLost = vi.fn();
  getToken = vi.fn().mockResolvedValue("tok");
});
afterEach(() => vi.unstubAllGlobals());

describe("12 AC1 — requestBlob success", () => {
  it("sends GET with bearer token, request id and Accept, and returns the bytes unchanged plus the filename", async () => {
    const body = '{"name":"Zoë — ünïcode","crlf":"a\\r\\nb"}\r\n';
    fetchMock.mockResolvedValue(new Response(body, { status: 200, headers: jsonHeaders() }));

    const result = await make().requestBlob(PATH, { fallbackFilename: "fallback.json" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}${PATH}`);
    expect(init.method).toBe("GET");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("x-request-id")).toBeTruthy();
    expect(result.filename).toBe("strength-in-numbers-export-2026-10-14.json");
    expect(await result.blob.text()).toBe(body);
  });

  it("uses the fallback name when Content-Disposition is missing", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const result = await make().requestBlob(PATH, { fallbackFilename: "fallback.json" });
    expect(result.filename).toBe("fallback.json");
  });
});

describe("12 AC3 — requestBlob errors", () => {
  it("maps a 429 with Retry-After to ApiError.retryAfterMs", async () => {
    fetchMock.mockResolvedValue(problemResponse(429, "rate-limited", { "retry-after": "12" }));
    const error = await make().requestBlob(PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).retryAfterMs).toBe(12_000);
    expect((error as ApiError).requestId).toBeTruthy();
  });

  it("maps a non-JSON error body to a generic status error", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    const error = (await make().requestBlob(PATH).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.isNetworkError).toBe(false);
  });

  it("maps a fetch rejection to a network ApiError", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = (await make().requestBlob(PATH).catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(error.status).toBe(0);
  });

  it("maps a body-read failure (blob() rejecting) to a network ApiError", async () => {
    const response = new Response("{}", { status: 200, headers: jsonHeaders() });
    vi.spyOn(response, "blob").mockRejectedValue(new TypeError("terminated"));
    fetchMock.mockResolvedValue(response);
    const error = (await make().requestBlob(PATH).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetworkError).toBe(true);
  });

  it("refuses a 2xx that is not JSON (an HTML page from a proxy) instead of returning it as the export", async () => {
    fetchMock.mockResolvedValue(new Response("<html>captive portal</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const error = (await make().requestBlob(PATH).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.title).toBe("Malformed response");
  });
});

describe("12 AC4 — shared transport", () => {
  it("on a 401 refreshes the token once and retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(problemResponse(401, "invalid-token"))
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: jsonHeaders() }));
    await make().requestBlob(PATH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(2, { ignoreCache: true });
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it("on a second 401 calls onAuthLost and throws", async () => {
    fetchMock.mockResolvedValue(problemResponse(401, "invalid-token"));
    const error = await make().requestBlob(PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });

  it("rejects when the signal is aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        // Like real fetch: an already-aborted signal rejects at once (the token await lets abort() run first).
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort);
      }),
    );
    const pending = make().requestBlob(PATH, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ApiError);
  });
});
