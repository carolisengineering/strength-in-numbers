import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createLogger } from "./logging.js";
import { createPrisma, checkDatabaseReady } from "./db.js";
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
  const exerciseRepository = createExerciseRepository(prisma);

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
    userRepository: createUserRepository(prisma),
    exerciseRepository,
    workoutRepository: createWorkoutRepository(prisma, exerciseRepository),
    personalRecordRepository: createPersonalRecordRepository(prisma),
    routineRepository: createRoutineRepository(prisma),
    accountExportRepository: createAccountExportRepository(prisma),
    hevyRepository: createHevyRepository(prisma),
    hevyImportRepository: createHevyImportRepository(prisma),
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
