import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

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

export function createPrisma(config: Config): PrismaClient {
  return new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(config.databaseUrl),
    log: ["warn", "error"],
  });
}

export async function checkDatabaseReady(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
