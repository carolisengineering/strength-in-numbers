import { pino, stdSerializers, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { Config } from "./config.js";

/**
 * Root pino logger (Spec 01 §6.4, §7; issue #7).
 *
 * `email` / `display_name` must never reach a log line (Spec 01 §7). Two
 * mechanisms enforce that, and both are exercised by `test/unit/logging.test.ts`:
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
 */

const PRISMA_ERROR_NAME = /^PrismaClient/;

function isPrismaError(err: unknown): err is Error & { code?: unknown; clientVersion?: unknown } {
  return err instanceof Error && PRISMA_ERROR_NAME.test(err.name);
}

/**
 * Returns `err` with every Prisma error in its `cause` chain replaced by a stub
 * that keeps `name` / `code` / `clientVersion` but no message, `meta`, or stack
 * frames beyond the header line. Non-Prisma errors are shallow-copied only when
 * something beneath them changed, so the common path allocates nothing.
 */
function scrubPrismaErrors(err: unknown, depth = 0): unknown {
  if (!(err instanceof Error) || depth > 8) return err;

  const cause = scrubPrismaErrors(err.cause, depth + 1);

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

  if (cause === err.cause) return err;

  // Keep the prototype so `type` still reports the original class; `message`
  // and `stack` are non-enumerable own props, so copy them explicitly.
  const copy: Error = Object.assign(Object.create(Object.getPrototypeOf(err) as object), err);
  copy.message = err.message;
  copy.stack = err.stack;
  copy.cause = cause;
  return copy;
}

const errSerializer = (err: unknown): unknown =>
  stdSerializers.errWithCause(scrubPrismaErrors(err) as Error);

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
        "*.email",
        "*.*.email",
        "*.displayName",
        "*.*.displayName",
        "*.display_name",
        "*.*.display_name",
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
