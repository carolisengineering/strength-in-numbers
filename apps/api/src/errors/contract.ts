import type { FastifyInstance } from "fastify";
import { NotFoundError, RateLimitedError, SyncTokenExpiredError } from "./app-error.js";
import { problemResponse } from "./problem.js";
import { clientAddress } from "../plugins/rate-limit.js";

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
      // Spec 03.3 AC8's `Cache-Control: no-store` (a cached 410 would keep a
      // healed client failing) comes from the /v1 cache policy, like every /v1
      // error (plugins/cache-policy.ts, #18).
      // warn + slug, so a real restore / client bug stands out from routine 4xx
      // (scoped to this class; the wider severity fix is BL-5).
      request.log.warn({ err, slug: err.slug }, "sync token expired");
    } else if (err instanceof RateLimitedError) {
      // Spec 05.2 AC9 / AC16: expected traffic shaping, not a server fault.
      reply.header("retry-after", String(err.retryAfterSeconds));
      const { layer, group } = err.source;
      request.log.warn(
        layer === "ip" || layer === "ip-docs"
          ? { layer, ip: clientAddress(request) }
          : { layer, group, userId: request.user?.id },
        "rate_limited",
      );
    } else {
      // Internal reason to the logs; the client only ever sees the generic body.
      request.log.error({ err }, "request error");
    }
    problemResponse(reply, err);
  });
}
