import type { FastifyReply } from "fastify";
import {
  AppError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  type FieldError,
} from "./app-error.js";

/**
 * RFC 9457 problem+json mapping (Spec 01 §5).
 *
 * `normalizeError` folds anything thrown — AppError, a Fastify schema-validation
 * error, a Fastify 404/413, or a raw Error — into an AppError. `toProblem`
 * renders the wire body. `problemResponse` is the Fastify glue.
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

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

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
