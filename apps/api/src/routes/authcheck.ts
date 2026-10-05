import type { FastifyInstance } from "fastify";

/**
 * `GET /v1/_authcheck` (Spec 01 §5).
 *
 * Token-validation probe for the CI smoke. Verifies the token (via the auth
 * plugin) and echoes only non-sensitive claim data. Does NOT provision — an M2M
 * token has no `email` claim and must still get a 200 here.
 */
export function registerAuthcheckRoute(app: FastifyInstance): void {
  app.get(
    "/_authcheck",
    // `hide: true` — smoke-only probe with no response schema, so it opts out
    // of the egress-allowlist check (Spec 03.0 §6.5). Not `published`, so it
    // stays out of the OpenAPI document (#10).
    { config: { skipProvisioning: true }, schema: { hide: true } },
    async (request) => {
      const auth = request.auth!;
      return {
        sub: auth.authSub,
        aud: auth.claims.aud ?? null,
        exp: auth.claims.exp ?? null,
      };
    },
  );
}
