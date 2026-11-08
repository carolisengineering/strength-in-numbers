import type { FastifyInstance, RouteOptions } from "fastify";
import { buildApp } from "../../../src/app.js";
import { checkDatabaseReady } from "../../../src/db.js";
import { GENEROUS_LIMITS, testConfig } from "../../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../../helpers/fakes.js";
import { appRepositories, type AppIntegrationDb } from "../helpers.js";

export type WorldActor = "A" | "B" | "C";

/** The Auth0 subject each actor's token signs in as. */
export const AUTH_SUB: Record<WorldActor, string> = { A: "auth0|xu-a", B: "auth0|xu-b", C: "auth0|xu-c" };

/**
 * Spec 21.0 AC17 — the real app over the given database handle. Spec 21.1 AC30: every
 * repository is built from `db.app`, the restricted login, through `createScopedDb` as
 * in `server.ts`, so the suite runs the statements production runs, as production's
 * login. Nothing reads a module-level client.
 *
 * Tokens: `Bearer A` / `Bearer B` / `Bearer C` sign in as the three world users.
 * `GENEROUS_LIMITS`: a `429` anywhere in the suite is a failure, never an answer.
 */
export async function makeCrossUserApp(
  db: Pick<AppIntegrationDb, "app">,
  opts: { hevyUsers?: readonly string[]; onRoute?: (route: RouteOptions) => void } = {},
): Promise<{ app: FastifyInstance; as(actor: WorldActor): Record<string, string> }> {
  const app = await buildApp({
    config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set(opts.hevyUsers ?? [])) },
    logger: false,
    checkReadiness: () => checkDatabaseReady(db.app),
    tokenVerifier: fakeVerifier((token) => {
      const sub = AUTH_SUB[token as WorldActor];
      if (sub === undefined) throw new Error(`unexpected bearer token in the cross-user suite: ${token}`);
      return authContext({ authSub: sub, email: `${token.toLowerCase()}@cross-user.test` });
    }),
    ...appRepositories(db.app),
    rateLimits: GENEROUS_LIMITS,
    ...(opts.onRoute ? { onRoute: opts.onRoute } : {}),
  });
  return { app, as: (actor) => ({ authorization: `Bearer ${actor}` }) };
}
