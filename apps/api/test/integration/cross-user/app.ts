import type { FastifyInstance, RouteOptions } from "fastify";
import { buildApp } from "../../../src/app.js";
import { checkDatabaseReady } from "../../../src/db.js";
import { createScopedDb } from "../../../src/db/scoped.js";
import { createUserRepository } from "../../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../../src/repositories/routine.prisma.js";
import { createAccountExportRepository } from "../../../src/repositories/account-export.prisma.js";
import { createHevyRepository } from "../../../src/repositories/hevy.prisma.js";
import { createHevyImportRepository } from "../../../src/repositories/hevy-import.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../../helpers/fakes.js";
import type { IntegrationDb } from "../helpers.js";

export type WorldActor = "A" | "B" | "C";

/** The Auth0 subject each actor's token signs in as. */
export const AUTH_SUB: Record<WorldActor, string> = { A: "auth0|xu-a", B: "auth0|xu-b", C: "auth0|xu-c" };

/**
 * Spec 21.0 AC17 — the real app over the given database handle. Every repository
 * is built from `db.prisma` here; nothing reads a module-level client, so Spec
 * 21.1 can run the same suite on the restricted login by passing another handle.
 * Spec 21.1 Phase B: the repositories get `createScopedDb(db.prisma)`, as in
 * `server.ts`, so the suite runs the scoped statements production runs.
 *
 * Tokens: `Bearer A` / `Bearer B` / `Bearer C` sign in as the three world users.
 * `GENEROUS_LIMITS`: a `429` anywhere in the suite is a failure, never an answer.
 */
export async function makeCrossUserApp(
  db: Pick<IntegrationDb, "prisma">,
  opts: { hevyUsers?: readonly string[]; onRoute?: (route: RouteOptions) => void } = {},
): Promise<{ app: FastifyInstance; as(actor: WorldActor): Record<string, string> }> {
  const scoped = createScopedDb(db.prisma);
  const exerciseRepository = createExerciseRepository(scoped);
  const app = await buildApp({
    config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set(opts.hevyUsers ?? [])) },
    logger: false,
    checkReadiness: () => checkDatabaseReady(db.prisma),
    tokenVerifier: fakeVerifier((token) => {
      const sub = AUTH_SUB[token as WorldActor];
      if (sub === undefined) throw new Error(`unexpected bearer token in the cross-user suite: ${token}`);
      return authContext({ authSub: sub, email: `${token.toLowerCase()}@cross-user.test` });
    }),
    userRepository: createUserRepository(scoped),
    exerciseRepository,
    workoutRepository: createWorkoutRepository(scoped, exerciseRepository),
    personalRecordRepository: createPersonalRecordRepository(db.prisma),
    routineRepository: createRoutineRepository(db.prisma),
    accountExportRepository: createAccountExportRepository(db.prisma),
    hevyRepository: createHevyRepository(db.prisma),
    hevyImportRepository: createHevyImportRepository(db.prisma),
    rateLimits: GENEROUS_LIMITS,
    ...(opts.onRoute ? { onRoute: opts.onRoute } : {}),
  });
  return { app, as: (actor) => ({ authorization: `Bearer ${actor}` }) };
}
