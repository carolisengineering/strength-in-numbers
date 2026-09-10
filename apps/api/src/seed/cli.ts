/**
 * `pnpm --filter @sin/api run seed:catalog [catalog-dir]` (Spec 03.1 §6.3, §8, §11).
 *
 * Manual release step for M1: run right after `prisma migrate deploy`, against
 * the same `DATABASE_URL` (direct Neon host, see the runbook). Idempotent — a
 * re-run with unchanged files reports everything `unchanged`.
 *
 * Catalog directory: first CLI arg, else `CATALOG_DIR`, else the checked-in
 * `apps/api/prisma/catalog/` (resolved relative to this file so it works from
 * both `src/` under tsx and `dist/` in the Docker image).
 *
 * Exit code 1 on any validation / append-only failure; the message names the
 * offending `catalog_key` when one row is to blame. Nothing is written in that
 * case — validation runs before the transaction and the transaction rolls back.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { pino } from "pino";
import { resolveDatabaseUrl } from "../db.js";
import { loadCatalog, seedCatalog, SeedError } from "./catalog.js";

const DEFAULT_CATALOG_DIR = fileURLToPath(
  new URL("../../prisma/catalog/", import.meta.url),
);

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const log = pino({ level: env.LOG_LEVEL ?? "info" });
  const dir = argv[0] ?? env.CATALOG_DIR ?? DEFAULT_CATALOG_DIR;
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    log.error("DATABASE_URL is required");
    return 1;
  }

  let prisma: PrismaClient | undefined;
  try {
    const catalog = await loadCatalog(dir);
    log.info(
      {
        dir,
        muscleGroups: catalog.muscleGroups.length,
        equipment: catalog.equipment.length,
        exercises: catalog.exercises.length,
      },
      "catalog files validated",
    );

    prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl(databaseUrl) });
    const summary = await seedCatalog(prisma, catalog, log);
    log.info(summary, "catalog seed complete");
    return 0;
  } catch (err) {
    if (err instanceof SeedError) {
      log.error({ catalogKey: err.catalogKey }, `seed aborted: ${err.message}`);
    } else {
      log.error({ err }, "seed failed");
    }
    return 1;
  } finally {
    await prisma?.$disconnect();
  }
}

// Run when invoked directly (`node dist/seed/cli.js`, or via prisma/seed.ts).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
