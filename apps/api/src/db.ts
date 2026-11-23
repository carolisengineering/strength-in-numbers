import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import type { PoolMetricsHandle, PoolMetricsSource } from "./telemetry/db-pool.js";
import type { TelemetryHandle } from "./telemetry/sdk.js";

import { resolveDatabaseUrl } from "./db/database-url.js";

/** Moved to `db/database-url.ts` (minor 416), which the owner-login module can import with no Prisma client. */
export { resolveDatabaseUrl };

/** A client for a raw `DATABASE_URL`: always through `resolveDatabaseUrl` (TLS + pool backfill), with the app's Prisma log levels. */
export function prismaFor(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: resolveDatabaseUrl(databaseUrl), log: ["warn", "error"] });
}

export function createPrisma(config: Config): PrismaClient {
  return prismaFor(config.databaseUrl);
}

export async function checkDatabaseReady(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** Spec 13.3 AC6 — the pool size the URL asks for (`resolveDatabaseUrl` backfills 8), or `undefined` if absent or not a positive integer. */
export function connectionLimitOf(resolvedUrl: string): number | undefined {
  const raw = new URL(resolvedUrl).searchParams.get("connection_limit");
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const limit = Number(raw);
  return limit > 0 ? limit : undefined;
}

/**
 * Spec 13.3 §6.3 — Prisma's pool numbers as a structural source for `telemetry/db-pool.ts`. `$metrics.json()` starts
 * the engine (and so opens a connection) when it isn't running, so `engineStarted` reads the library engine's own
 * `libraryStarted` flag: false before the first query and again after `$disconnect` (AC7). The flag is internal;
 * `prisma-metrics-guard.test.ts` pins it.
 */
export function poolMetricsSource(prisma: PrismaClient): PoolMetricsSource {
  return {
    engineStarted: () => (prisma as unknown as { _engine?: { libraryStarted?: unknown } })._engine?.libraryStarted === true,
    json: () => prisma.$metrics.json(),
  };
}

/** Registers the pool metrics when telemetry is on (a handle exists); with it off, touches nothing (AC1). */
/** The pool metrics' handle, stopped by shutdown before `$disconnect` (minor 358); `undefined` with telemetry off. */
export function wirePoolMetrics(handle: TelemetryHandle | undefined, prisma: PrismaClient, databaseUrl: string): PoolMetricsHandle | undefined {
  if (!handle) return undefined;
  return handle.registerDbPool(poolMetricsSource(prisma), connectionLimitOf(resolveDatabaseUrl(databaseUrl)));
}
