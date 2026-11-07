import type { RouteKey } from "./registry.js";

/**
 * Spec 21.0 §5, AC5 — the `/v1` routes with no cross-user case, one line each
 * with its reason. Adding a line here is a reviewed diff (D5): a route that
 * reads or writes another row must get a case in `cases.ts` instead.
 */
export const EXEMPTIONS: Record<RouteKey, string> = {
  "GET /v1/_authcheck": "Answers only about the verified token; skips provisioning and reads no row.",
  "GET /v1/me": "Returns the caller's own user row; the user comes from the token and the route takes no id.",
  "PATCH /v1/me": "Writes only the caller's own user row (profile fields); the route takes no id.",
  "GET /v1/muscle-groups": "Shared reference data with no user column; every user gets the same list.",
  "GET /v1/equipment": "Shared reference data with no user column; every user gets the same list.",
};
