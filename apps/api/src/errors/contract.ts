import type { FastifyInstance } from "fastify";
import { NotFoundError } from "./app-error.js";
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
    // Internal reason to the logs; the client only ever sees the generic body.
    request.log.error({ err }, "request error");
    problemResponse(reply, err);
  });
}
