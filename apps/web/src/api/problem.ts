/**
 * RFC 9457 `application/problem+json` parsing + the typed `ApiError` the API
 * client throws (Spec 04.0 §6.4, AC11). React-free, DOM-free (Q13).
 *
 * The API's wire contract (`apps/api/src/errors/problem.ts`):
 *
 *   Content-Type: application/problem+json
 *   {
 *     type:     "https://strengthinnumbers.app/problems/<slug>",
 *     title:    string,
 *     status:   number,
 *     detail:   string,          // fixed, generic, value-free
 *     instance: string,          // the request id the API accepted
 *     errors?:  Array<{ path: string; message: string }>   // 422 only, value-free
 *   }
 *
 * `ApiError.type` is stored as the slug (last path segment of `type`); the raw
 * value is kept on `typeUrl`.
 */

export interface ProblemFieldError {
  readonly path: string;
  readonly message: string;
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string | undefined;
  readonly errors: readonly ProblemFieldError[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function coerceFieldErrors(value: unknown): ProblemFieldError[] {
  if (!Array.isArray(value)) return [];
  const out: ProblemFieldError[] = [];
  for (const entry of value) {
    if (
      isRecord(entry) &&
      typeof entry["path"] === "string" &&
      typeof entry["message"] === "string"
    ) {
      out.push({ path: entry["path"], message: entry["message"] });
    }
  }
  return out;
}

/**
 * Parse a decoded JSON body as an RFC 9457 problem. Returns `null` when the body
 * is not object-shaped or carries none of `status` / `title` / `type` — the
 * caller then builds a generic error. Never throws.
 */
export function parseProblem(
  body: unknown,
  fallbackStatus: number,
): Problem | null {
  if (!isRecord(body)) return null;

  const looksLikeProblem =
    typeof body["status"] === "number" ||
    typeof body["title"] === "string" ||
    typeof body["type"] === "string";
  if (!looksLikeProblem) return null;

  return {
    type: typeof body["type"] === "string" ? body["type"] : "about:blank",
    title: typeof body["title"] === "string" ? body["title"] : "Request failed",
    status:
      typeof body["status"] === "number" ? body["status"] : fallbackStatus,
    detail: typeof body["detail"] === "string" ? body["detail"] : "",
    instance:
      typeof body["instance"] === "string" ? body["instance"] : undefined,
    errors: coerceFieldErrors(body["errors"]),
  };
}

/** A problem `type` URL → its slug (last path-ish segment). Spec 04.0 §6.4. */
export function slugFromType(type: string): string {
  if (type === "" || type === "about:blank") return "about:blank";
  const withoutScheme = type.includes("://")
    ? type.slice(type.indexOf("://") + 3)
    : type;
  const path = withoutScheme.split(/[?#]/)[0] ?? withoutScheme;
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.at(-1) ?? type;
}

export interface ApiErrorInit {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly requestId: string;
  readonly isNetworkError?: boolean;
  readonly cause?: unknown;
}

/**
 * The single error type every `apiClient` call rejects with. UI code branches on
 * `status` / `type` / the `isX()` predicates; `requestId` is shown on error
 * screens for support correlation.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  readonly status: number;
  /** Slug — last path segment of the problem `type`, e.g. `"invalid-token"`. */
  readonly type: string;
  /** The raw problem `type` value: a URL, or `"about:blank"`. */
  readonly typeUrl: string;
  readonly title: string;
  readonly detail: string;
  readonly instance: string | undefined;
  readonly errors: readonly ProblemFieldError[];
  readonly requestId: string;
  readonly isNetworkError: boolean;

  constructor(init: ApiErrorInit) {
    super(
      `${init.status} ${init.title}`,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.status = init.status;
    this.typeUrl = init.type;
    this.type = slugFromType(init.type);
    this.title = init.title;
    this.detail = init.detail ?? "";
    this.instance = init.instance;
    this.errors = init.errors ?? [];
    this.requestId = init.requestId;
    this.isNetworkError = init.isNetworkError ?? false;
  }

  /** `422 validation-error`. */
  isValidation(): boolean {
    return this.status === 422;
  }

  /** `401 unauthenticated` / `invalid-token`. */
  isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** `503 auth-unavailable` (retryable). */
  isUnavailable(): boolean {
    return this.status === 503;
  }

  static fromProblem(problem: Problem, requestId: string): ApiError {
    return new ApiError({
      status: problem.status,
      type: problem.type,
      title: problem.title,
      detail: problem.detail,
      instance: problem.instance,
      errors: problem.errors,
      requestId,
      isNetworkError: false,
    });
  }

  /** A `fetch` rejection: DNS, offline, TLS, CORS, dropped connection. */
  static network(requestId: string, cause: unknown): ApiError {
    return new ApiError({
      status: 0,
      type: "about:blank",
      title: "Network error",
      detail: "The request could not reach the server.",
      requestId,
      isNetworkError: true,
      cause,
    });
  }
}
