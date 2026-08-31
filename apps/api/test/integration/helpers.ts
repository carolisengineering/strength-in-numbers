import { execFileSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";

/**
 * These need a Docker daemon (Testcontainers). They self-skip unless
 * RUN_INTEGRATION=1 so `pnpm test` is green on a machine without Docker; CI sets
 * it in the dedicated integration job.
 */
export function shouldRunIntegration(): boolean {
  return process.env.RUN_INTEGRATION === "1";
}

export interface IntegrationDb {
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
  url: string;
  stop: () => Promise<void>;
}

export async function startIntegrationDb(): Promise<IntegrationDb> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sin_test")
    .start();
  const url = container.getConnectionUri();

  // Apply the real migrations exactly as Render's pre-deploy step would.
  execFileSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" },
  );

  const prisma = new PrismaClient({ datasourceUrl: url });
  return {
    container,
    prisma,
    url,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
