import type { FastifyInstance } from "fastify";
import { NotFoundError, RateLimitedError, SyncTokenExpiredError } from "./app-error.js";
import { normalizeError, problemResponse } from "./problem.js";
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
    // Normalized once: it picks the log level below and is the problem sent. The original `err` is what
    // gets logged, so the serializer still sees (and scrubs) the Prisma / Zod / validation error itself.
    const problem = normalizeError(err);
    if (err instanceof SyncTokenExpiredError) {
      // Spec 03.3 AC8's `Cache-Control: no-store` (a cached 410 would keep a
      // healed client failing) comes from the /v1 cache policy, like every /v1
      // error (plugins/cache-policy.ts, #18).
      // warn + slug, so a real restore / client bug stands out from routine 4xx.
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
    } else if (problem.status >= 500) {
      // Internal reason to the logs; the client only ever sees the generic body.
      request.log.error({ err }, "request error");
    } else {
      // #27 / BL-5: a 4xx is the client's mistake or ordinary traffic (a 404, a 409, a 422), so it logs at
      // info and an error-level line still means "look". A token that fails verification is the exception:
      // a broken Auth0 setup or a forged-token probe must stand out, so it is a warn (a missing token is not).
      const { slug, status } = problem;
      if (slug === "invalid-token") request.log.warn({ err, slug, status }, "request rejected");
      else request.log.info({ err, slug, status }, "request rejected");
    }
    problemResponse(reply, problem);
  });
}
