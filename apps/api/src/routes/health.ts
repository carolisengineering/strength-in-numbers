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

interface ReadinessCache {
  at: number;
  ok: boolean;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthDeps,
): void {
  const ttlMs = deps.readinessTtlMs ?? 3_000;
  let cache: ReadinessCache | null = null;

  app.get("/healthz", async () => ({ status: "ok" as const }));

  app.get("/readyz", async (_request, reply) => {
    const now = Date.now();
    if (cache === null || now - cache.at >= ttlMs) {
      try {
        await deps.checkReadiness();
        cache = { at: now, ok: true };
      } catch (err) {
        _request.log.warn({ err }, "readiness check failed");
        cache = { at: now, ok: false };
      }
    }

    if (cache.ok) {
      return { status: "ready" as const };
    }
    return problemResponse(reply, new NotReadyError("readiness check failed"));
  });
}
