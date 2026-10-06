/**
 * `pnpm --filter @sin/api run records:rebuild [--user <id>]` (Spec 07.0 §6.5, §11).
 *
 * Manual release step after `prisma migrate deploy`, against the same
 * DATABASE_URL (direct Neon host — runbook B4 / B5a). Idempotent, and safe
 * against live traffic: it takes the same per-user lock as the finish and
 * delete paths. Logs ids and counts only — never record values.
 *
 * Exit code 1 on a missing or rejected DATABASE_URL, any argument other than
 * `--user <id>` / `--user=<id>`, or any failure;
 * a failed user's transaction rolls back and earlier users stay rebuilt.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { pino } from "pino";
import { isUserId } from "@sin/core";
import { resolveDatabaseUrl } from "../db.js";
import { rebuildRecords } from "./rebuild.js";

export type RebuildArgs = { ok: true; userId: string | undefined } | { ok: false; error: string };

/**
 * The only accepted forms are no arguments, `--user <id>` and `--user=<id>`.
 * Anything else is an error rather than ignored: a mistyped flag must never
 * silently widen a one-user repair into a rebuild of every user.
 */
export function parseRebuildArgs(argv: readonly string[]): RebuildArgs {
  let userId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let value: string | undefined;
    if (arg === "--") continue; // `pnpm run records:rebuild -- --user <id>` may forward it
    if (arg === "--user") {
      value = argv[++i];
    } else if (arg.startsWith("--user=")) {
      value = arg.slice("--user=".length);
    } else {
      return { ok: false, error: `unrecognised argument: ${arg} (usage: [--user <id>])` };
    }
    if (userId !== undefined) return { ok: false, error: "--user given more than once" };
    if (value === undefined || !isUserId(value)) return { ok: false, error: "--user needs a user id (uuid)" };
    userId = value;
  }
  return { ok: true, userId };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const log = pino({ level: env.LOG_LEVEL ?? "info" });
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    log.error("DATABASE_URL is required");
    return 1;
  }
  const args = parseRebuildArgs(argv);
  if (!args.ok) {
    log.error(args.error);
    return 1;
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl(databaseUrl) });
    const summary = await rebuildRecords(prisma, log, { userId: args.userId });
    log.info(summary, "records rebuild complete");
    return 0;
  } catch (err) {
    log.error({ err }, "records rebuild failed");
    return 1;
  } finally {
    await prisma?.$disconnect();
  }
}

// Run when invoked directly (`node dist/records/cli.js`, or via scripts/rebuild-records.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
