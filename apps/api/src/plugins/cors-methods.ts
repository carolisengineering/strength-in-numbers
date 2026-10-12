/**
 * The HTTP methods the API allows cross-origin (the browser's CORS preflight).
 * The single list `@fastify/cors` is configured from. A method missing here is
 * refused by the browser before the request is sent, which the SPA can only
 * report as a network failure ("You're offline") — the 2026-10-11 routine-edit
 * bug, where `PUT /v1/routines/{id}` was missing.
 */
export const CORS_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** Never preflighted, and Fastify registers one automatically for every GET. */
const NOT_PREFLIGHTED: ReadonlySet<string> = new Set(["HEAD"]);

/**
 * Runs in the root `onRoute` hook (like `assertPublication`), so a route whose
 * method the CORS policy would refuse fails app assembly — in the server, the
 * emit script and the tests alike — instead of failing silently in a browser.
 */
export function assertCorsAllowsMethod(route: {
  method: string | readonly string[];
  url: string;
}): void {
  const methods = [route.method].flat().map((m) => m.toUpperCase());
  const missing = methods.filter((m) => !NOT_PREFLIGHTED.has(m) && !CORS_METHODS.includes(m));
  if (missing.length > 0) {
    throw new Error(
      `Route ${methods.join(",")} ${route.url} uses ${missing.join(", ")}, which the CORS policy ` +
        "does not allow, so a browser would refuse the request. Add it to CORS_METHODS " +
        "(apps/api/src/plugins/cors-methods.ts).",
    );
  }
}
