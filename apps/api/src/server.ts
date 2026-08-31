import { pino } from "pino";
import { loadConfig, ConfigError } from "./config.js";
import { buildApp } from "./app.js";
import { createPrisma, checkDatabaseReady } from "./db.js";
import { createTokenVerifier } from "./auth/verify.js";
import { createUserRepository } from "./repositories/user.prisma.js";
import { createGracefulShutdown } from "./shutdown.js";

/**
 * Composition root (Spec 01 §6.4). Loads config fail-fast, wires the real
 * collaborators, installs signal handlers, and binds the port.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const logger = pino({
    level: config.logLevel,
    base: { service: config.serviceName },
    // `email` / `display_name` must never reach a log line (Spec 01 §7).
    redact: {
      paths: [
        "req.headers.authorization",
        "*.email",
        "*.displayName",
        "*.display_name",
      ],
      remove: true,
    },
  });

  const prisma = createPrisma(config);

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
  });

  const shutdown = createGracefulShutdown({ app, prisma, logger });
  process.on("SIGTERM", (s) => void shutdown(s));
  process.on("SIGINT", (s) => void shutdown(s));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, env: config.nodeEnv }, "api listening");
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    // Fail-fast, before a port is bound (Spec 01 criterion 2).
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `Fatal startup error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
