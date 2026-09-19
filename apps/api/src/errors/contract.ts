import type { FastifyInstance } from "fastify";
import { NotFoundError, SyncTokenExpiredError } from "./app-error.js";
import { problemResponse } from "./problem.js";

/**
 * Installs the RFC 9457 error + not-found handlers on a Fastify context
 * (Spec 01 §5). Called on the root app and again inside the `/v1` encapsulated
 * scope so schema-validation errors raised there are rendered as problem+json
 * (Fastify does not always cascade a parent error handler into a child context).
 */
export function registerErrorContract(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    problemResponse(
      reply,
      new NotFoundError(`route ${request.method} ${request.url} not found`),
    );
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof SyncTokenExpiredError) {
      // Spec 03.3 AC8: a 410 is heuristically cacheable; a cached one would keep
      // a healed client failing.
      reply.header("cache-control", "no-store");
      // warn + slug, so a real restore / client bug stands out from routine 4xx
      // (scoped to this class; the wider severity fix is BL-5).
      request.log.warn({ err, slug: err.slug }, "sync token expired");
    } else {
      // Internal reason to the logs; the client only ever sees the generic body.
      request.log.error({ err }, "request error");
    }
    problemResponse(reply, err);
  });
}
