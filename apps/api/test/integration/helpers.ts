import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

/** A fresh Postgres container with **no** migrations applied. */
export async function startBareDb(): Promise<IntegrationDb> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sin_test")
    .start();
  const url = container.getConnectionUri();
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

export async function startIntegrationDb(): Promise<IntegrationDb> {
  const db = await startBareDb();
  // Apply the real migrations exactly as Render's pre-deploy step would.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: db.url },
    stdio: "inherit",
  });
  return db;
}

/**
 * Applies one migration's SQL file to `url` — used to stop the schema at an
 * earlier migration (e.g. 0003) before applying the one under test. `db execute`
 * sends the whole script as a single simple-protocol command, so a `$$` function
 * body works.
 */
export function applyMigrationFile(url: string, migrationDir: string): void {
  const file = fileURLToPath(
    new URL(`../../prisma/migrations/${migrationDir}/migration.sql`, import.meta.url),
  );
  execFileSync(
    "pnpm",
    ["exec", "prisma", "db", "execute", "--url", url, "--file", file],
    { stdio: "inherit" },
  );
}
