import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { POSTGRES_IMAGE } from "./postgres-image.js";

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
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("sin_test")
    .start();
  const url = container.getConnectionUri();
  const prisma = new PrismaClient({
    datasourceUrl: url,
    log: [{ emit: "event", level: "query" }],
  });
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

/** #21 — the one user fixture: a fresh id unless the test needs a known one; the column default timezone is UTC. */
export async function insertUser(db: IntegrationDb, opts: { id?: string; timezone?: string } = {}): Promise<string> {
  const id = opts.id ?? uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "user" ("id","auth_sub","email","timezone") VALUES ($1::uuid,$2,'u@ex.com',$3)`,
    id,
    `auth0|${id}`,
    opts.timezone ?? "UTC",
  );
  return id;
}

/** #21 — the one exercise fixture: active, global and uncurated unless the options say otherwise. Returns the id. */
export async function insertExercise(
  db: IntegrationDb,
  opts: {
    id?: string;
    name?: string;
    modality?: string;
    ownerUserId?: string | null;
    forkedFrom?: string;
    catalogKey?: string | null;
    isActive?: boolean;
  } = {},
): Promise<string> {
  const id = opts.id ?? uuidv7();
  // Positional params bind as text; uuid columns need an explicit cast.
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "exercise" ("id","catalog_key","owner_user_id","forked_from_exercise_id","name","modality","is_active")
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7)`,
    id,
    opts.catalogKey ?? null,
    opts.ownerUserId ?? null,
    opts.forkedFrom ?? null,
    opts.name ?? `Exercise ${id.slice(-4)}`,
    opts.modality ?? "weight_reps",
    opts.isActive ?? true,
  );
  return id;
}
