import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import type { PoolMetricsSource } from "./telemetry/db-pool.js";
import type { TelemetryHandle } from "./telemetry/sdk.js";

/**
 * Prisma client + readiness probe (Spec 01 §6.4, §8 Q9).
 *
 * Render's managed Postgres caps connections low and requires TLS, but its
 * blueprint hands us the raw connection string. We backfill `sslmode=require`
 * and a conservative `connection_limit` if the URL doesn't already carry them,
 * so a single web instance can't exhaust the pool (`P2024`).
 *
 * TLS verification (#8): Prisma's engine (quaint) only understands
 * `sslmode=disable|prefer|require` and silently downgrades anything else —
 * including libpq's `verify-full` — to `prefer`, i.e. TLS *optional*. Whether
 * the server certificate is validated at all is a separate knob, `sslaccept`,
 * whose engine default is `accept_invalid_certs`. `sslaccept=strict` makes
 * native-tls do its normal validation: chain against the OS trust store plus
 * hostname — libpq's `verify-full` in effect. Neon's certs chain to ISRG Root
 * X1 (publicly trusted; the Dockerfile installs `ca-certificates`), so no
 * bundle is needed; a private CA (RDS, Spec 15) goes in via `sslcert=<path>`.
 *
 * `prisma migrate deploy` reads the raw env URL and bypasses this function, so
 * the stored `DATABASE_URL` secret should carry `sslaccept=strict` itself — see
 * the runbook. This backfill covers the app and the seed CLI.
 */

const DEFAULT_CONNECTION_LIMIT = "8";
const PRISMA_SSL_MODES = new Set(["disable", "prefer", "require"]);

export function resolveDatabaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
  const sslmode = url.searchParams.get("sslmode") ?? "require";
  // The server never reaches this branch — `loadConfig` rejects these modes
  // first as a ConfigError. It stays because the seed CLI builds its client
  // from the raw env without going through `loadConfig`.
  if (!PRISMA_SSL_MODES.has(sslmode)) {
    throw new Error(
      `DATABASE_URL: sslmode=${sslmode} is not supported by Prisma's engine (it would ` +
        `silently downgrade to prefer). Use sslmode=require&sslaccept=strict for ` +
        `certificate + hostname verification.`,
    );
  }
  if (sslmode !== "disable" && !url.searchParams.has("sslaccept")) {
    url.searchParams.set("sslaccept", "strict");
  }
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", DEFAULT_CONNECTION_LIMIT);
  }
  return url.toString();
}

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
export function wirePoolMetrics(handle: TelemetryHandle | undefined, prisma: PrismaClient, databaseUrl: string): boolean {
  if (!handle) return false;
  handle.registerDbPool(poolMetricsSource(prisma), connectionLimitOf(resolveDatabaseUrl(databaseUrl)));
  return true;
}
