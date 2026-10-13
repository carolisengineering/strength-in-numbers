/**
 * `pnpm --filter @sin/api run account:purge [--confirm] [--user <id>] [--skip-grace]`
 * (Spec 11 §6.4). An operator task (runbook "Account deletion requests"), not
 * a release step. Dry run unless `--confirm`. Against the direct-host
 * DATABASE_URL, like `records:rebuild`. Logs ids and counts only — never email.
 *
 * Exit 1 on: a missing or rejected DATABASE_URL, any unrecognized or repeated
 * argument, `--skip-grace` without `--user`, a `--user` target that was not
 * purged (or, in a dry run, not listed), or any account that failed.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { pino } from "pino";
import { isUserId } from "@sin/core";
import { resolveDatabaseUrl } from "../db.js";
import { runPurge, type PurgeOptions } from "./purge.js";

const USAGE = "usage: [--confirm] [--user <id>] [--skip-grace]";

export type PurgeArgs = { ok: true; options: PurgeOptions } | { ok: false; error: string };

/** The `parseRebuildArgs` idiom: anything unrecognized is an error, never
 * ignored — a mistyped flag must never widen a one-account run. */
export function parsePurgeArgs(argv: readonly string[]): PurgeArgs {
  let confirm = false;
  let skipGrace = false;
  let userId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue; // pnpm may forward it
    if (arg === "--confirm") {
      if (confirm) return { ok: false, error: "--confirm given more than once" };
      confirm = true;
      continue;
    }
    if (arg === "--skip-grace") {
      if (skipGrace) return { ok: false, error: "--skip-grace given more than once" };
      skipGrace = true;
      continue;
    }
    let value: string | undefined;
    if (arg === "--user") value = argv[++i];
    else if (arg.startsWith("--user=")) value = arg.slice("--user=".length);
    else return { ok: false, error: `unrecognized argument: ${arg} (${USAGE})` };
    if (userId !== undefined) return { ok: false, error: "--user given more than once" };
    if (value === undefined || !isUserId(value)) return { ok: false, error: "--user needs a user id (uuid)" };
    userId = value;
  }
  if (skipGrace && userId === undefined) return { ok: false, error: "--skip-grace requires --user" };
  return { ok: true, options: { confirm, skipGrace, ...(userId !== undefined ? { userId } : {}) } };
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: { makePrisma?: (url: string) => PrismaClient } = {},
): Promise<number> {
  const log = pino({ level: env.LOG_LEVEL ?? "info" });
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    log.error("DATABASE_URL is required");
    return 1;
  }
  const args = parsePurgeArgs(argv);
  if (!args.ok) {
    log.error(args.error);
    return 1;
  }
  let url: string;
  try {
    url = resolveDatabaseUrl(databaseUrl);
  } catch (err) {
    // Not `{ err }`: a malformed URL's TypeError carries the raw string (password
    // included) in an enumerable `input` property that pino would print.
    log.error({ error_class: (err as Error)?.constructor?.name ?? typeof err, reason: (err as Error)?.message }, "DATABASE_URL rejected");
    return 1;
  }

  const owned = deps.makePrisma === undefined;
  const prisma = deps.makePrisma ? deps.makePrisma(url) : new PrismaClient({ datasourceUrl: url });
  try {
    const summary = await runPurge(prisma, log, args.options);
    return summary.failed > 0 || summary.targetMissed ? 1 : 0;
  } catch (err) {
    log.error({ err }, "account purge failed");
    return 1;
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

// Run when invoked directly (`node dist/account/purge-cli.js`, or via scripts/purge-accounts.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
