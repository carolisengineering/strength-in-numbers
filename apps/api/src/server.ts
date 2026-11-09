import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createLogger } from "./logging.js";
import { createPrisma, checkDatabaseReady, wirePoolMetrics } from "./db.js";
import { createScopedDb } from "./db/scoped.js";
import { assertLoginCannotBypassRls, UnsafeDatabaseLoginError } from "./db/login-check.js";
import { warnIfRlsDisabled } from "./db/rls.js";
import { createTokenVerifier } from "./auth/verify.js";
import { createUserRepository } from "./repositories/user.prisma.js";
import { createExerciseRepository } from "./repositories/exercise.prisma.js";
import { createWorkoutRepository } from "./repositories/workout.prisma.js";
import { createRoutineRepository } from "./repositories/routine.prisma.js";
import { createAccountExportRepository } from "./repositories/account-export.prisma.js";
import { createHevyRepository } from "./repositories/hevy.prisma.js";
import { createHevyImportRepository } from "./repositories/hevy-import.prisma.js";
import { createPersonalRecordRepository } from "./repositories/personal-record.prisma.js";
import { createGracefulShutdown } from "./shutdown.js";
import { startupFailureMessage } from "./startup-failure.js";
import { getTelemetryHandle } from "./telemetry/handle.js";

/**
 * Composition root (Spec 01 §6.4). Loads config fail-fast, wires the real
 * collaborators, installs signal handlers, and binds the port.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const logger = createLogger(config);

  const prisma = createPrisma(config);
  wirePoolMetrics(getTelemetryHandle(), prisma, config.databaseUrl); // Spec 13.3: only when telemetry is on
  // Spec 21.1 AC25: before anything can listen, refuse a login that could bypass row-level security. No opt-out.
  try {
    logger.info(await assertLoginCannotBypassRls(prisma), "db_login_checked");
  } catch (err) {
    if (err instanceof UnsafeDatabaseLoginError) logger.error(err.facts, "db_login_checked");
    throw err;
  }
  // Spec 21.1: the boot check ignores whether RLS is on (D5), so a kill switch left off after an incident shows here.
  await warnIfRlsDisabled(prisma, logger);
  // Spec 21.1 AC20: every repository gets the scoped handle, never the bare client ("who is asking" on every call).
  const db = createScopedDb(prisma);
  const exerciseRepository = createExerciseRepository(db);

  const app = await buildApp({
    config,
    logger,
    checkReadiness: () => checkDatabaseReady(prisma),
    tokenVerifier: createTokenVerifier({
      issuer: config.auth0.issuer,
      audience: config.auth0.audience,
      claimNamespace: config.auth0.claimNamespace,
      jwksUri: config.auth0.jwksUri,
    }),
    userRepository: createUserRepository(db),
    exerciseRepository,
    workoutRepository: createWorkoutRepository(db, exerciseRepository),
    personalRecordRepository: createPersonalRecordRepository(db),
    routineRepository: createRoutineRepository(db),
    accountExportRepository: createAccountExportRepository(db),
    hevyRepository: createHevyRepository(db),
    hevyImportRepository: createHevyImportRepository(db),
  });

  const shutdown = createGracefulShutdown({ app, prisma, logger, telemetry: getTelemetryHandle() });
  process.on("SIGTERM", (s) => void shutdown(s));
  process.on("SIGINT", (s) => void shutdown(s));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, env: config.nodeEnv }, "api listening");
}

main().catch((err: unknown) => {
  // A ConfigError fails fast, before a port is bound (Spec 01 criterion 2).
  process.stderr.write(startupFailureMessage(err));
  process.exit(1);
});
