/**
 * Spec 15 AC15 — the `deploy` job's first step after approval: refuse a release whose commit holds a migration
 * the production database has not applied (or one that failed, or an unreachable database). Read-only:
 * `prisma migrate status` never writes. The database URL (and its host) is removed from anything printed.
 *
 *   DATABASE_URL=<neon direct url> pnpm --filter @sin/api exec tsx scripts/check-migrate-status.ts
 */
import { spawnSync } from "node:child_process";
import { classifyMigrateStatus, scrubDatabaseUrl } from "./lib/migrate-status.js";

function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write("check-migrate-status: missing env DATABASE_URL\n");
    process.exit(1);
  }
  const run = spawnSync("pnpm", ["--filter", "@sin/api", "exec", "prisma", "migrate", "status"], {
    env: process.env,
    encoding: "utf8",
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const status = classifyMigrateStatus(output, run.status ?? 1);
  process.stdout.write(scrubDatabaseUrl(output, databaseUrl));
  if (status.ok) {
    process.stdout.write(`\ncheck-migrate-status: ok (${status.state})\n`);
    return;
  }
  process.stderr.write(`\ncheck-migrate-status: refused (${status.state}) — run the migration by hand (runbook), then re-dispatch\n`);
  process.exit(1);
}

main();
