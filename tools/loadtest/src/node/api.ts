import { randomUUID } from "node:crypto";

/** Spec 16 — the CLI's own API calls (seed and cleanup). Lifters' requests go through k6, not this. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface Api {
  get(path: string): Promise<ApiResponse>;
  post(path: string, body: unknown): Promise<ApiResponse>;
  patch(path: string, body: unknown): Promise<ApiResponse>;
  del(path: string): Promise<{ status: number }>;
}

/** Bearer auth and a fresh `X-Request-Id` per request (the API honors ids matching `[A-Za-z0-9._-]{1,128}`). */
export function apiFor(baseUrl: string, token: string, fetchFn: typeof fetch = fetch): Api {
  const call = async (method: string, path: string, body?: unknown): Promise<ApiResponse> => {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": `loadtest-${randomUUID()}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
    del: async (path) => ({ status: (await call("DELETE", path)).status }),
  };
}
