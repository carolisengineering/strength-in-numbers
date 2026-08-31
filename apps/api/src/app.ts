import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyBaseLogger,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
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

export interface BuildAppDeps extends AuthPluginDeps {
  config: Config;
  logger?: FastifyBaseLogger | boolean;
  /** Resolves when ready to take traffic; rejects otherwise (Spec 01 §5). */
  checkReadiness: () => Promise<void>;
  readinessTtlMs?: number;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  const app = Fastify({
    logger: deps.logger ?? false,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    ajv: { customOptions: { allErrors: true, removeAdditional: false } },
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

  return app;
}
