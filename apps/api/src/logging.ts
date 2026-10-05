import { pino, stdSerializers, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { Config } from "./config.js";

/**
 * Root pino logger (Spec 01 §6.4, §7; issues #7, #11).
 *
 * `email` / `display_name` must never reach a log line (Spec 01 §7). Three
 * mechanisms enforce that, all exercised by `test/unit/logging.test.ts`:
 *
 * 1. `redact.paths` — key-based, applied to the *serialized* log object (pino
 *    runs serializers first, then redaction). The paths go two wildcard levels
 *    deep so `{ err: { meta: { email } } }` and `{ ctx: { user: { email } } }`
 *    are covered, and include the Auth0 namespaced claim keys (which contain
 *    `/` and `.`, so a bare `*.email` can never match them).
 *
 * 2. A Prisma-aware `err` serializer — Prisma's `PrismaClientValidationError`
 *    message dumps the full query arguments (`data: { email: "…" }`), and
 *    `PrismaClientKnownRequestError` carries an enumerable `meta`. Neither is a
 *    key redaction can reach (the PII is *inside a string*), so any Prisma error
 *    in the cause chain is replaced by a stub before pino's standard serializer
 *    runs. Ordinary errors keep their message and stack untouched.
 *
 * 3. A Zod-aware step in the same walk (#11). A `ZodError`'s `message` and
 *    `stack` are a JSON dump of its issues, and an issue can carry the parsed
 *    value: a custom `error:` message that interpolates it (on a refine *or* a
 *    built-in check like `.max()`), `params` from a `superRefine`, or `input`
 *    when a parse sets `reportInput`. A response-schema violation on `/v1/me`
 *    would put the user's email there. So a Zod error is replaced by a stub that
 *    keeps only schema-shaped issue fields (see `KEPT_ZOD_ISSUE_FIELDS`) — no
 *    message at all, since any message may be custom.
 */

const PRISMA_ERROR_NAME = /^PrismaClient/;

function isPrismaError(err: unknown): err is Error & { code?: unknown; clientVersion?: unknown } {
  return err instanceof Error && PRISMA_ERROR_NAME.test(err.name);
}

// `zod` throws `ZodError`; `zod/v4/core` (which fastify-type-provider-zod parses
// with) throws `$ZodError`. Matched by name + shape alone — NOT `instanceof
// Error`: only the variant `parse` / `safeParse` throw is an `Error`; a
// hand-built `new z.ZodError(issues)` is a plain object, yet pino still logs its
// `message` (the issue dump) when it sits in a cause chain.
const ZOD_ERROR_NAME = /^\$?ZodError$/;

interface ZodErrorLike {
  name: string;
  issues: unknown[];
  cause?: unknown;
}

function isZodError(err: unknown): err is ZodErrorLike {
  if (typeof err !== "object" || err === null) return false;
  const { name, issues } = err as { name?: unknown; issues?: unknown };
  return typeof name === "string" && ZOD_ERROR_NAME.test(name) && Array.isArray(issues);
}

/** Issue fields that come from the schema, never from the parsed value:
 * which check failed and where, type / format names, the schema's own bounds,
 * and the *names* of unrecognised keys (what you need to debug an over-wide
 * handler return). Everything else — `message`, `input`, `params`, `pattern`,
 * `values` — is dropped. */
const KEPT_ZOD_ISSUE_FIELDS = [
  "code",
  "path",
  "expected",
  "origin",
  "format",
  "minimum",
  "maximum",
  "inclusive",
  "keys",
] as const;

/** Bounds the log line for a large array response that fails every element. */
const MAX_ZOD_ISSUES = 20;

function scrubZodIssue(issue: unknown, depth: number): Record<string, unknown> {
  if (typeof issue !== "object" || issue === null) return {};
  const source = issue as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_ZOD_ISSUE_FIELDS) {
    if (source[field] !== undefined) kept[field] = source[field];
  }
  // `invalid_union` nests one issue list per branch; scrub those too, one level.
  if (depth === 0 && Array.isArray(source.errors)) {
    kept.errors = source.errors.map((branch: unknown) =>
      Array.isArray(branch) ? branch.slice(0, MAX_ZOD_ISSUES).map((i) => scrubZodIssue(i, 1)) : [],
    );
  }
  return kept;
}

const MAX_CAUSE_DEPTH = 8;

/** The stub that stands in for a PII-bearing error, or `undefined` to keep it. */
function stubFor(err: Error | ZodErrorLike, cause: unknown): Error | undefined {
  if (isPrismaError(err)) {
    const stub = new Error(`[redacted ${err.name}]`);
    stub.name = err.name;
    stub.stack = `${err.name}: [redacted]`;
    Object.assign(stub, {
      code: typeof err.code === "string" ? err.code : undefined,
      clientVersion: typeof err.clientVersion === "string" ? err.clientVersion : undefined,
      cause,
    });
    return stub;
  }
  if (isZodError(err)) {
    const issues = err.issues.slice(0, MAX_ZOD_ISSUES).map((i) => scrubZodIssue(i, 0));
    const truncated = err.issues.length - issues.length;
    const stub = new Error(`[scrubbed ${err.name}: ${err.issues.length} issue(s)]`);
    stub.name = err.name;
    stub.stack = `${err.name}: [scrubbed]`;
    Object.assign(stub, { issues, ...(truncated > 0 ? { issuesTruncated: truncated } : {}), cause });
    return stub;
  }
  return undefined;
}

/**
 * Returns `err` with every Prisma or Zod error in its `cause` chain (and in an
 * `AggregateError`'s `errors`, which pino serializes too) replaced by a stub
 * (`stubFor`) that keeps only the fields safe to log. Other errors are
 * shallow-copied only when something beneath them changed, so the common path
 * allocates nothing.
 *
 * Fails closed: past `MAX_CAUSE_DEPTH` the rest of the chain is replaced by a
 * marker rather than logged unscrubbed.
 */
function scrubErrorChain(err: unknown, depth = 0): unknown {
  // A Zod error is checked first: it may not be an `Error` (see `isZodError`).
  if (!(err instanceof Error) && !isZodError(err)) return err;
  if (depth > MAX_CAUSE_DEPTH) return new Error("[redacted: cause chain too deep]");

  const cause = scrubErrorChain(err.cause, depth + 1);
  const stub = stubFor(err, cause);
  if (stub !== undefined) return stub;
  // Only a Zod error can be a non-`Error` here, and it always got a stub.
  if (!(err instanceof Error)) return err;

  const errors =
    err instanceof AggregateError
      ? err.errors.map((e: unknown) => scrubErrorChain(e, depth + 1))
      : undefined;

  const errorsChanged =
    errors !== undefined && errors.some((e, i) => e !== (err as AggregateError).errors[i]);
  if (cause === err.cause && !errorsChanged) return err;

  // Keep the prototype so `type` still reports the original class; `message`
  // and `stack` are non-enumerable own props, so copy them explicitly.
  const copy: Error = Object.assign(Object.create(Object.getPrototypeOf(err) as object), err);
  copy.message = err.message;
  copy.stack = err.stack;
  copy.cause = cause;
  if (errors !== undefined) (copy as AggregateError).errors = errors;
  return copy;
}

const errSerializer = (err: unknown): unknown =>
  stdSerializers.errWithCause(scrubErrorChain(err) as Error);

export function loggerOptions(config: Config): LoggerOptions {
  const ns = config.auth0.claimNamespace;
  const nsEmail = `["${ns}email"]`;
  return {
    level: config.logLevel,
    base: { service: config.serviceName },
    serializers: { err: errSerializer },
    redact: {
      paths: [
        "req.headers",
        // Bare keys too: fast-redact's `*` needs an enclosing key, so without
        // these a `log.info(request.auth)` would emit the top-level fields.
        "email",
        "*.email",
        "*.*.email",
        "displayName",
        "*.displayName",
        "*.*.displayName",
        "display_name",
        "*.display_name",
        "*.*.display_name",
        "claims",
        "*.claims",
        "*.*.claims",
        nsEmail,
        `*${nsEmail}`,
        `*.*${nsEmail}`,
      ],
      remove: true,
    },
  };
}

export function createLogger(config: Config, destination?: DestinationStream): Logger {
  const options = loggerOptions(config);
  return destination ? pino(options, destination) : pino(options);
}
