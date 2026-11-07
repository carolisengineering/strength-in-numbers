import type { FastifyInstance, FastifySchema, RouteOptions } from "fastify";

/**
 * Spec 21.0 §6.1 — the route registry. The app itself reports every route it
 * registers through `buildApp`'s `onRoute` observer, so the cross-user suite's
 * coverage gate checks the truth about what the app serves, not a hand-kept list.
 */

export type RouteKey = `${string} ${string}`;

export interface RegisteredRoute {
  key: RouteKey;
  method: string;
  /** Fastify's prefixed template, e.g. `/v1/workouts/:id`. */
  url: string;
  schema: FastifySchema | undefined;
}

/** Routes outside `/v1`, each with the reason it needs no cross-user case (AC4). */
export const NON_V1_ROUTES: Record<RouteKey, string> = {
  "GET /healthz": "Liveness probe: unauthenticated, reads no user data, answers only `{ status, commit }`.",
  "GET /readyz": "Readiness probe: unauthenticated, checks the database connection, returns no rows.",
  "GET /openapi.json": "The published contract: route and schema metadata only, rendered once at boot, no user data.",
};

/** `HEAD` is Fastify's automatic twin of each `GET`; `OPTIONS` are CORS preflights (D8). */
const SKIPPED_METHODS = new Set(["HEAD", "OPTIONS"]);

/**
 * Builds the app with an observer, waits for every plugin to load, and returns
 * the routes split into `/v1` and the rest, in registration order.
 */
export async function collectRoutes(
  build: (onRoute: (route: RouteOptions) => void) => Promise<FastifyInstance>,
): Promise<{ v1: RegisteredRoute[]; other: RegisteredRoute[] }> {
  const seen: RegisteredRoute[] = [];
  const app = await build((route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (SKIPPED_METHODS.has(method)) continue;
      seen.push({ key: `${method} ${route.url}`, method, url: route.url, schema: route.schema });
    }
  });
  await app.ready();
  await app.close();
  return {
    v1: seen.filter((r) => r.url === "/v1" || r.url.startsWith("/v1/")),
    other: seen.filter((r) => !(r.url === "/v1" || r.url.startsWith("/v1/"))),
  };
}
