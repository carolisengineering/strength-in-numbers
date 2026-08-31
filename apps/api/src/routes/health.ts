import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/app-error.js";
import { problemResponse } from "../errors/problem.js";

/**
 * Health endpoints (Spec 01 §5).
 *
 * `/healthz` — liveness, no auth, no DB, the Render platform check target.
 * `/readyz`  — readiness, no auth, runs the injected check but caches the
 *              result for `readinessTtlMs` (default 3 s) so an unauthenticated
 *              caller cannot amplify load onto Postgres. Deploy-gated by the CI
 *              post-deploy smoke, not the platform.
 */

class NotReadyError extends AppError {
  readonly status = 503;
  readonly slug = "not-ready";
  readonly title = "Not ready";
  readonly publicDetail = "The service is not ready to accept requests.";
}

export interface HealthDeps {
  /** Resolves when ready; throws/rejects when not (e.g. `SELECT 1` failed). */
  checkReadiness: () => Promise<void>;
  readinessTtlMs?: number;
}

interface ReadinessResult {
  at: number;
  ok: boolean;
  error?: unknown;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthDeps,
): void {
  const ttlMs = deps.readinessTtlMs ?? 3_000;
  let cache: ReadinessResult | null = null;
  let inFlight: Promise<ReadinessResult> | null = null;

  // Serve a cached result within the TTL; otherwise run the probe once and let
  // every concurrent caller await that single in-flight run (not one SELECT 1
  // per request).
  const probeReadiness = (): Promise<ReadinessResult> => {
    if (cache !== null && Date.now() - cache.at < ttlMs) {
      return Promise.resolve(cache);
    }
    inFlight ??= (async (): Promise<ReadinessResult> => {
      const at = Date.now();
      try {
        await deps.checkReadiness();
        return { at, ok: true };
      } catch (error) {
        return { at, ok: false, error };
      }
    })().then((result) => {
      cache = result;
      inFlight = null;
      return result;
    });
    return inFlight;
  };

  app.get("/healthz", async () => ({ status: "ok" as const }));

  app.get("/readyz", async (request, reply) => {
    const result = await probeReadiness();
    if (result.ok) {
      return { status: "ready" as const };
    }
    request.log.warn({ err: result.error }, "readiness check failed");
    return problemResponse(reply, new NotReadyError("readiness check failed"));
  });
}
