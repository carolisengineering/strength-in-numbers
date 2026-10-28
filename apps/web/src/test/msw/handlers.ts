import { http, HttpResponse, type RequestHandler } from "msw";

/**
 * Default MSW handlers. Nearly empty by design — the API client suite registers per-test handlers with
 * `server.use(...)` and the shared server is configured `onUnhandledRequest: "error"`, so an un-mocked request fails
 * loudly.
 *
 * The defaults, all Spec 20.0:
 * - AC1: Profile reads `GET /v1/hevy/status` on every render, and for every account but the owner the API answers
 *   its unknown-route `404`. A test that wants the Hevy row overrides it with `server.use(...)`.
 * - AC17: the Hevy screen's mapping card reads `GET /v1/hevy/mapping`; by default the owner has none yet.
 */
export const handlers: RequestHandler[] = [
  http.get("*/v1/hevy/mapping", () => HttpResponse.json({ pairs: [], sectionRules: [] })),
  http.get(
    "*/v1/hevy/status",
    () =>
      new HttpResponse(
        JSON.stringify({ type: "https://strengthinnumbers.app/problems/not-found", title: "Not Found", status: 404, detail: "d", instance: "req-1" }),
        { status: 404, headers: { "content-type": "application/problem+json" } },
      ),
  ),
];
