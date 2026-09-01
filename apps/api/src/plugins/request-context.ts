import fp from "fastify-plugin";

/**
 * Request context (Spec 01 §3, §6.4).
 *
 * Fastify already derives `request.id` from an inbound `X-Request-Id` header
 * (configured in buildApp) or a generated UUID, and binds it to `request.log`.
 * This plugin echoes that id back on every response so a caller can correlate.
 */
export const requestContextPlugin = fp(
  async (app) => {
    app.addHook("onRequest", async (request, reply) => {
      reply.header("x-request-id", request.id);
    });
  },
  { name: "request-context" },
);
