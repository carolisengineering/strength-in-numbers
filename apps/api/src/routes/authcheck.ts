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
    { config: { skipProvisioning: true } },
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
