import { reportError } from "../observability/reportError";
import { ApiError, parseProblem } from "./problem";
import { newRequestId, REQUEST_ID_HEADER } from "./requestId";

/**
 * React-free authed API client (Spec 04.0 §6.4, Q13, AC11 / AC12).
 *
 * Takes callbacks, not React: `getToken` (bound to Auth0's
 * `getAccessTokenSilently` by `useApi` in step 4) and `onAuthLost` (a
 * `logout`-based reset). Imports no React and touches no DOM beyond `fetch` /
 * `crypto.randomUUID`, so a future React Native app can lift it as-is.
 *
 * Per request: attach `Authorization: Bearer` + a fresh `X-Request-Id`; map a
 * non-2xx `application/problem+json` body to a typed `ApiError`; a `fetch`
 * rejection becomes an `ApiError` with `isNetworkError` / `status: 0`; on a
 * `401`, refresh the token once and retry once. 2xx bodies are `schema.parse`d
 * when a `@sin/core` schema is supplied — a mismatch throws when
 * `appEnv !== "production"` and is downgraded to a `console.warn` plus a
 * `reportError()` call in production (Q15; Spec 04.0 §9 — the seam shipped in
 * Spec 04.1).
 */

export type AppEnv = "local" | "staging" | "production";

export interface GetTokenOptions {
  ignoreCache?: boolean;
}

/** Structurally satisfied by any `@sin/core` Zod schema (`z.infer` DTO). */
export interface ResponseSchema<T> {
  parse: (data: unknown) => T;
}

export interface CreateApiClientOptions {
  readonly baseUrl: string;
  readonly appEnv: AppEnv;
  readonly getToken: (options?: GetTokenOptions) => Promise<string>;
  readonly onAuthLost: () => void;
}

export interface ApiRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly schema?: ResponseSchema<unknown>;
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  request: <T = unknown>(path: string, options?: ApiRequestOptions) => Promise<T>;
  get: <T = unknown>(path: string, schema?: ResponseSchema<T>) => Promise<T>;
  post: <T = unknown>(
    path: string,
    body?: unknown,
    schema?: ResponseSchema<T>,
  ) => Promise<T>;
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    schema?: ResponseSchema<T>,
  ) => Promise<T>;
  delete: <T = unknown>(path: string, schema?: ResponseSchema<T>) => Promise<T>;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/**
 * `/v1/workouts/018f…?x=1` → `/v1/workouts/:id`. Keeps observability tags
 * static: no query string, no UUID / numeric path segments.
 */
export function routeTemplate(path: string): string {
  const [pathname = ""] = path.split(/[?#]/);
  return pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const { baseUrl, appEnv, getToken, onAuthLost } = options;

  async function fetchOnce(
    url: string,
    options_: ApiRequestOptions,
    requestId: string,
    ignoreCache: boolean,
  ): Promise<Response> {
    let token: string;
    try {
      token = await getToken(ignoreCache ? { ignoreCache: true } : undefined);
    } catch (cause) {
      // No token — a lost session (cold cache `missing_refresh_token`, or a
      // rotation-reuse failure). AC12.
      onAuthLost();
      throw new ApiError({
        status: 0,
        type: "about:blank",
        title: "Session expired",
        detail: "Could not obtain an access token.",
        requestId,
        isNetworkError: false,
        cause,
      });
    }

    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      [REQUEST_ID_HEADER]: requestId,
    });

    let payload: string | undefined;
    if (options_.body !== undefined) {
      headers.set("Content-Type", "application/json");
      try {
        payload = JSON.stringify(options_.body);
      } catch (cause) {
        // A non-serializable body (BigInt, circular ref). `ApiError` is the one
        // type every client call rejects with, so surface it as one rather than
        // a raw TypeError the UI's `instanceof ApiError` branches would miss.
        throw new ApiError({
          status: 0,
          type: "about:blank",
          title: "Invalid request body",
          detail: "The request body could not be serialized to JSON.",
          requestId,
          isNetworkError: false,
          cause,
        });
      }
    }

    try {
      return await fetch(url, {
        method: options_.method ?? "GET",
        headers,
        body: payload,
        signal: options_.signal,
      });
    } catch (cause) {
      throw ApiError.network(requestId, cause);
    }
  }

  async function readError(
    response: Response,
    requestId: string,
  ): Promise<ApiError> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const problem = parseProblem(body, response.status);
      if (problem) return ApiError.fromProblem(problem, requestId);
    } else {
      // Drain the body defensively; its content is not useful.
      try {
        await response.text();
      } catch {
        /* ignore */
      }
    }
    return new ApiError({
      status: response.status,
      type: "about:blank",
      title: response.statusText || "Request failed",
      detail: `The server responded with ${response.status}.`,
      requestId,
      isNetworkError: false,
    });
  }

  async function request<T = unknown>(
    path: string,
    options_: ApiRequestOptions = {},
  ): Promise<T> {
    const requestId = newRequestId();
    const url = `${baseUrl}${path}`;

    let response = await fetchOnce(url, options_, requestId, false);

    if (response.status === 401) {
      response = await fetchOnce(url, options_, requestId, true);
      if (response.status === 401) {
        const error = await readError(response, requestId);
        onAuthLost();
        throw error;
      }
    }

    if (!response.ok) {
      throw await readError(response, requestId);
    }

    let data: unknown;
    if (response.status === 204) {
      data = undefined;
    } else {
      try {
        data = await response.json();
      } catch (cause) {
        throw new ApiError({
          status: response.status,
          type: "about:blank",
          title: "Malformed response",
          detail: "The server returned a 2xx response that was not valid JSON.",
          requestId,
          isNetworkError: false,
          cause,
        });
      }
    }

    const { schema } = options_;
    if (schema) {
      try {
        return schema.parse(data) as T;
      } catch (error) {
        if (appEnv !== "production") throw error;
        console.warn(
          `[api] ${path} response failed schema validation; passing the raw body through (requestId=${requestId})`,
        );
        // Static tags only (DESIGN §8.1): the query string is dropped and
        // id-like segments are replaced so no per-user value reaches the seam.
        reportError(error, {
          source: "api-schema",
          path: routeTemplate(path),
          requestId,
        });
        return data as T;
      }
    }

    return data as T;
  }

  function get<T = unknown>(
    path: string,
    schema?: ResponseSchema<T>,
  ): Promise<T> {
    return request<T>(path, { method: "GET", schema });
  }

  function post<T = unknown>(
    path: string,
    body?: unknown,
    schema?: ResponseSchema<T>,
  ): Promise<T> {
    return request<T>(path, { method: "POST", body, schema });
  }

  function patch<T = unknown>(
    path: string,
    body?: unknown,
    schema?: ResponseSchema<T>,
  ): Promise<T> {
    return request<T>(path, { method: "PATCH", body, schema });
  }

  function del<T = unknown>(
    path: string,
    schema?: ResponseSchema<T>,
  ): Promise<T> {
    return request<T>(path, { method: "DELETE", schema });
  }

  return { request, get, post, patch, delete: del };
}
