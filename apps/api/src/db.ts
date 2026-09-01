import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

/**
 * Prisma client + readiness probe (Spec 01 §6.4, §8 Q9).
 *
 * Render's managed Postgres caps connections low and requires TLS, but its
 * blueprint hands us the raw connection string. We backfill `sslmode=require`
 * and a conservative `connection_limit` if the URL doesn't already carry them,
 * so a single web instance can't exhaust the pool (`P2024`).
 */

const DEFAULT_CONNECTION_LIMIT = "8";

export function resolveDatabaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", DEFAULT_CONNECTION_LIMIT);
  }
  return url.toString();
}

export function createPrisma(config: Config): PrismaClient {
  return new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(config.databaseUrl),
    log: ["warn", "error"],
  });
}

export async function checkDatabaseReady(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
