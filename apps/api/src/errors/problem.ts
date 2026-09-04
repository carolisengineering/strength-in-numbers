import type { FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  ResponseSerializationError,
} from "fastify-type-provider-zod";
import {
  AppError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  type FieldError,
} from "./app-error.js";

/**
 * RFC 9457 problem+json mapping (Spec 01 §5; Zod branches added in Spec 03.0 §6.2).
 *
 * `normalizeError` folds anything thrown — AppError, a `fastify-type-provider-zod`
 * request/response error, a Fastify AJV schema-validation error, a Fastify
 * 404/413, or a raw Error — into an AppError. `toProblem` renders the wire body.
 * `problemResponse` is the Fastify glue.
 *
 * Pinned to `fastify-type-provider-zod@7.x`: request failures are detected with
 * `hasZodFastifySchemaValidationErrors` (there is no `RequestValidationError`
 * class); response failures are `ResponseSerializationError` (the v7 name — older
 * drafts of this spec called it `ResponseValidationError`).
 */

export const PROBLEM_BASE_URL = "https://strengthinnumbers.app/problems/";

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: Array<{ path: string; message: string }>;
}

export interface ProblemResult {
  status: number;
  body: ProblemBody;
}

interface FastifyValidationIssue {
  instancePath?: string;
  message?: string;
  params?: { missingProperty?: string; additionalProperty?: string };
}

function isFastifyValidationError(
  e: unknown,
): e is Error & { validation: FastifyValidationIssue[] } {
  return (
    e instanceof Error &&
    Array.isArray((e as { validation?: unknown }).validation)
  );
}

function fieldPath(issue: FastifyValidationIssue): string {
  const fromPath = (issue.instancePath ?? "")
    .replace(/^\//, "")
    .replace(/\//g, ".");
  if (fromPath.length > 0) return fromPath;
  return (
    issue.params?.missingProperty ??
    issue.params?.additionalProperty ??
    "(body)"
  );
}

/**
 * A `fastify-type-provider-zod` validation entry (one per Zod issue). The
 * `params` object is the Zod issue minus `path` / `code` / `message`, so it may
 * carry constraint metadata (`expected`, `values`, `minimum`, `maximum`,
 * `origin`, `format`, `keys`) — never a value the caller submitted.
 */
interface ZodValidationEntry {
  keyword?: string;
  instancePath?: string;
  message?: string;
  params?: Record<string, unknown>;
}

/** Bare field name — no `body` / `querystring` prefix (Spec 03.0 §6.2). */
function zodFieldPath(entry: ZodValidationEntry): string {
  const fromPath = (entry.instancePath ?? "")
    .replace(/^\//, "")
    .replace(/\//g, ".");
  if (fromPath.length > 0) return fromPath;
  const keys = entry.params?.["keys"];
  if (Array.isArray(keys) && typeof keys[0] === "string") return keys[0];
  return "(body)";
}

/**
 * A fixed constraint phrase built from `issue.code` + constraint metadata only.
 * Zod's own messages for `invalid_type` / `invalid_value` name the *type* or the
 * allowed set — never the submitted value — but this mapper still refuses to
 * pass any raw value through: only whitelisted metadata keys are read, so a
 * token-shaped bad input can never be reflected into the `422` body.
 */
function zodIssueMessage(entry: ZodValidationEntry): string {
  const p = entry.params ?? {};
  const origin = typeof p["origin"] === "string" ? p["origin"] : undefined;
  const num = (k: string): number | undefined =>
    typeof p[k] === "number" ? (p[k] as number) : undefined;

  switch (entry.keyword) {
    case "invalid_type": {
      const expected = typeof p["expected"] === "string" ? p["expected"] : undefined;
      return expected ? `must be of type ${expected}` : "is the wrong type";
    }
    case "invalid_value":
    case "invalid_enum_value": {
      const values = p["values"];
      return Array.isArray(values) && values.length > 0
        ? `must be one of: ${values.join(", ")}`
        : "is not an allowed value";
    }
    case "too_big": {
      const max = num("maximum");
      if (max === undefined) return "is too large";
      return origin === "string"
        ? `must be at most ${max} characters`
        : `must be at most ${max}`;
    }
    case "too_small": {
      const min = num("minimum");
      if (min === undefined) return "is too small";
      if (origin === "string" && min === 1) return "must not be empty";
      return origin === "string"
        ? `must be at least ${min} characters`
        : `must be at least ${min}`;
    }
    case "invalid_format": {
      const format = typeof p["format"] === "string" ? p["format"] : undefined;
      return format ? `must be a valid ${format}` : "has an invalid format";
    }
    case "unrecognized_keys":
      return "is not a recognized field";
    case "custom":
      // The message on a `.refine()` — authored in `@sin/core`, never a value.
      return entry.message && entry.message.length > 0
        ? entry.message
        : "failed a validation rule";
    default:
      return "is invalid";
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // A `ResponseSerializationError` means a handler returned a shape that
  // violates its own declared `response` schema — a server bug, not a client
  // error. Map to a generic 500; the failing path/schema is left on `.cause` for
  // the error-handler log and never reaches the wire (Spec 03.0 §6.2, AC2).
  if (error instanceof ResponseSerializationError) {
    return new InternalError("response schema violation", { cause: error });
  }

  // Zod request validation — checked before the generic AJV branch because a
  // Zod failure also carries a `.validation` array (that is how the guard
  // works), and the Zod-aware mapper produces safer messages.
  if (hasZodFastifySchemaValidationErrors(error)) {
    const fieldErrors: FieldError[] = (error.validation as ZodValidationEntry[]).map(
      (entry) => ({
        path: zodFieldPath(entry),
        message: zodIssueMessage(entry),
      }),
    );
    return new ValidationError(fieldErrors, "zod schema validation failed");
  }

  if (isFastifyValidationError(error)) {
    const fieldErrors: FieldError[] = error.validation.map((issue) => ({
      path: fieldPath(issue),
      message: issue.message ?? "invalid",
    }));
    return new ValidationError(fieldErrors, "fastify schema validation failed");
  }

  const statusCode = (error as { statusCode?: number } | null | undefined)
    ?.statusCode;
  const code = (error as { code?: string } | null | undefined)?.code;

  if (statusCode === 404) return new NotFoundError("route not found");
  if (statusCode === 413 || code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new PayloadTooLargeError();
  }

  return new InternalError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

export function toProblem(error: unknown, instance: string): ProblemResult {
  const appErr = normalizeError(error);

  const body: ProblemBody = {
    type: `${PROBLEM_BASE_URL}${appErr.slug}`,
    title: appErr.title,
    status: appErr.status,
    detail: appErr.publicDetail,
    instance,
  };

  if (appErr.fieldErrors && appErr.fieldErrors.length > 0) {
    body.errors = appErr.fieldErrors.map((f) => ({
      path: f.path,
      message: f.message,
    }));
  }

  return { status: appErr.status, body };
}

export function problemResponse(reply: FastifyReply, error: unknown): FastifyReply {
  const { status, body } = toProblem(error, reply.request.id);
  return reply
    .code(status)
    .type("application/problem+json")
    .send(body);
}
