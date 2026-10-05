import type { FastifyInstance } from "fastify";

/**
 * One `Cache-Control` policy for every `/v1` response (issues #17, #18; DESIGN
 * §6). Set by a `/v1`-scope `onSend` hook; handlers never hand-set it.
 *
 * - **status ≥ 400 → `no-store`**, whatever the route declared: a `401` / `410`
 *   / `422` is heuristically cacheable, and a cached one keeps a healed client
 *   failing.
 * - **`config.httpCache: "revalidate"` → `private, no-cache`**, for the reads
 *   that serve an `ETag` (`/v1/exercises`, the reference tables): the browser
 *   keeps the body and revalidates with `If-None-Match` every time.
 * - **everything else → `no-store`**: no validator, so a stored copy could only
 *   be kept, never revalidated — and `/v1/me` is PII.
 *
 * No `Vary: Authorization` (#17). `private` already forbids every shared cache
 * (RFC 9111 §5.2.2.7), and under `no-cache` the browser's own cache only
 * reuses a body after the server answers `304` to *this* caller's
 * `If-None-Match` — i.e. when the stored bytes are exactly this caller's
 * response. `Vary` added nothing but a lost `304` every time the in-memory
 * access token rotated (every reload).
 *
 * Scope: replies from a matched `/v1` context — routes, the `/v1` not-found
 * handler, the auth hook, root L1 rejections of a `/v1` URL. A URL Fastify
 * cannot parse (bad percent-encoding → plain `400`) is answered before routing
 * and gets no `Cache-Control`; a `400` is not heuristically cacheable and carries
 * no data, so that is accepted.
 */

export type HttpCache = "revalidate";

declare module "fastify" {
  interface FastifyContextConfig {
    /** #18 — opt a `GET` that serves an `ETag` into `private, no-cache`. */
    httpCache?: HttpCache;
  }
}

export function cacheControlFor(status: number, httpCache: HttpCache | undefined): string {
  if (status >= 400) return "no-store";
  return httpCache === "revalidate" ? "private, no-cache" : "no-store";
}

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** Fails app assembly on an unknown `httpCache`, or one on a write route. */
export function assertHttpCacheConfig(route: {
  method: string | readonly string[];
  url: string;
  config?: { httpCache?: unknown };
}): void {
  const httpCache = route.config?.httpCache;
  if (httpCache === undefined) return;
  const methods = [route.method].flat();
  if (httpCache !== "revalidate" || !methods.every((m) => READ_METHODS.has(m))) {
    throw new Error(
      `Route ${methods.join(",")} ${route.url} declares config.httpCache ${JSON.stringify(httpCache)}; ` +
        'only "revalidate", and only on a GET that serves an ETag (#18).',
    );
  }
}

/** Wire the policy into the `/v1` scope. Call before any `/v1` route registers. */
export function registerV1CachePolicy(v1: FastifyInstance): void {
  v1.addHook("onRoute", (route) => assertHttpCacheConfig(route));
  v1.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", cacheControlFor(reply.statusCode, request.routeOptions.config?.httpCache));
    return payload;
  });
}
