import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyBaseLogger,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { registerErrorContract } from "./errors/contract.js";
import { requestContextPlugin } from "./plugins/request-context.js";
import { registerHealthRoutes } from "./routes/health.js";
import { authPlugin, type AuthPluginDeps } from "./plugins/auth.js";
import { registerV1Routes } from "./routes/v1.js";

/**
 * Fastify application assembly (Spec 01 §5.5, §6).
 *
 * Pure composition: all I/O collaborators are injected so the whole app is
 * exercised with `fastify.inject` and no live port. `buildApp` intentionally
 * does not call `.ready()` — the caller (or `inject`) does.
 */

export const BODY_LIMIT_BYTES = 64 * 1024;

/** An inbound X-Request-Id is honoured only if it matches this shape. */
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Egress field-allowlist invariant (Spec 03.0 §6.5). `fastify-type-provider-zod`
 * only strips unlisted keys from a response when the route declares a
 * `schema.response`; without one it falls back to unfiltered `JSON.stringify`
 * and an over-wide handler return (an internal column, `auth_sub`, a soft-delete
 * timestamp) reaches the wire. Registered as an `onRoute` hook so the allowlist
 * is structural — a wire-exposed `/v1` route with no `response` schema fails app
 * assembly in every environment rather than leaking at runtime. Hidden routes
 * (health probes, `/openapi.json`, `/v1/_authcheck`) and body-less methods are
 * exempt.
 */
export function assertRouteHasResponseSchema(route: {
  method: string | string[];
  url: string;
  schema?: { hide?: boolean; response?: unknown };
}): void {
  if (route.schema?.hide === true) return;
  if (!route.url.startsWith("/v1/")) return;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  if (methods.every((m) => m === "HEAD" || m === "OPTIONS")) return;
  if (route.schema?.response === undefined) {
    throw new Error(
      `Route ${methods.join(",")} ${route.url} declares no \`schema.response\`. ` +
        "Every /v1 route must declare a Zod response schema so the serializer " +
        "enforces a positive field allowlist (Spec 03.0 §6.5).",
    );
  }
}

export interface BuildAppDeps extends AuthPluginDeps {
  config: Config;
  logger?: FastifyBaseLogger | boolean;
  /** Resolves when ready to take traffic; rejects otherwise (Spec 01 §5). */
  checkReadiness: () => Promise<void>;
  readinessTtlMs?: number;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  // Fastify v5 takes a pre-built logger under `loggerInstance`, and only a
  // boolean/config object under `logger`.
  const loggerOption =
    typeof deps.logger === "object" && deps.logger !== null
      ? { loggerInstance: deps.logger }
      : { logger: deps.logger ?? false };

  const app = Fastify({
    ...loggerOption,
    // Don't trust an inbound X-Request-Id verbatim — it lands in every log line
    // and the problem+json `instance` field. Honour it only when it is sane;
    // otherwise generate one.
    requestIdHeader: false,
    genReqId: (req) => {
      const inbound = req.headers["x-request-id"];
      return typeof inbound === "string" && REQUEST_ID_RE.test(inbound)
        ? inbound
        : randomUUID();
    },
    bodyLimit: BODY_LIMIT_BYTES,
    ajv: { customOptions: { allErrors: true, removeAdditional: false } },
  });

  // The contract pipeline (Spec 03.0): Zod DTOs from `@sin/core` drive route
  // validation, handler typing, and the emitted OpenAPI document. Set on the
  // root instance so the `/v1` child scope inherits both compilers. The default
  // serializer parses every response through its `response` schema, so a plain
  // `z.object` schema is a positive field allowlist — an unlisted column cannot
  // reach the wire (AC7, §6.5).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Structural egress allowlist: fail assembly if a wire-exposed `/v1` route
  // ships without a `response` schema (see `assertRouteHasResponseSchema`).
  // Added on the root instance before the `/v1` scope so it sees those routes.
  app.addHook("onRoute", (routeOptions) => {
    assertRouteHasResponseSchema({
      method: routeOptions.method,
      url: routeOptions.url,
      schema: routeOptions.schema,
    });
  });

  await app.register(requestContextPlugin);

  await app.register(helmet, {
    // The API serves JSON only; the SPA's CSP is Spec 04's concern.
    contentSecurityPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  });

  await app.register(cors, {
    // Non-browser callers send no Origin and are allowed through; a browser
    // Origin must be on the exact-match allowlist. An unlisted Origin gets a
    // normal response with no allow-origin header (the browser blocks it) —
    // the API does not 403 it.
    origin: (origin, cb) => {
      cb(null, !origin || config.webOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
  });

  // Emit-only OpenAPI 3.1 (Spec 03.0 §6.3). Registered before any route so its
  // onRoute hook sees them all; the health + `_authcheck` routes opt out with
  // `schema.hide`. No `servers:` block — the document must not name an internal
  // host (§7). `@fastify/swagger-ui` is deliberately not registered (emit only).
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Strength in Numbers API",
        version: "1",
        description:
          "The public /v1 surface. Every listed route still requires a bearer token to call.",
      },
      // Make the "requires a bearer token" statement machine-readable: declare
      // the scheme and require it globally. Every documented route is an
      // authenticated `/v1` route, so a document-wide requirement is exact.
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "Auth0-issued access token for the API audience (Spec 01 §5).",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  registerHealthRoutes(app, {
    checkReadiness: deps.checkReadiness,
    readinessTtlMs: deps.readinessTtlMs,
  });

  registerErrorContract(app);

  // Everything under /v1 requires a valid token + a live user.
  await app.register(
    async (v1) => {
      registerErrorContract(v1);
      await v1.register(authPlugin, {
        tokenVerifier: deps.tokenVerifier,
        userRepository: deps.userRepository,
      });
      registerV1Routes(v1, { userRepository: deps.userRepository });
    },
    { prefix: "/v1" },
  );

  // `GET /openapi.json` — the published contract (Spec 03.0 §5, §6.3).
  // Unauthenticated by design (registered outside the `/v1` scope, so the auth
  // plugin never runs) — a deliberate carve-out from Spec 01 §7: the document is
  // route + schema metadata, no user data. Rendered once at boot and served as a
  // constant string so this anonymous route can never be a per-request
  // `app.swagger()` CPU amplifier.
  let openapiJson = "{}";
  app.addHook("onReady", async () => {
    openapiJson = JSON.stringify(app.swagger(), null, 2);
  });
  app.get("/openapi.json", { schema: { hide: true } }, async (_request, reply) =>
    reply
      .type("application/json")
      .header("cache-control", "public, max-age=300")
      .send(openapiJson),
  );

  return app;
}
