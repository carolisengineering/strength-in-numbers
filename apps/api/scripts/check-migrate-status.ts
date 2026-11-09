/**
 * Spec 15 AC15 — the `deploy` job's first step after approval: refuse a release whose commit holds a migration
 * the production database has not applied (or one that failed, or an unreachable database). Read-only:
 * `prisma migrate status` never writes. The database URL (and its host) is removed from anything printed.
 *
 *   OWNER_DATABASE_URL=<neon direct url> pnpm --filter @sin/api exec tsx scripts/check-migrate-status.ts
 */
import { spawnSync } from "node:child_process";
import { ownerDatabaseUrl } from "../src/db/owner-url.js";
import { classifyMigrateStatus, scrubDatabaseUrls } from "./lib/migrate-status.js";

function main(): void {
  const owner = ownerDatabaseUrl(process.env);
  if (!owner.ok) {
    process.stderr.write(`check-migrate-status: ${owner.error}\n`);
    process.exit(1);
  }
  // Through owner-env.mjs (Spec 21.1 §6.8): Prisma reads env("DATABASE_URL"), the owner's for this child only, and a URL
  // that would skip the certificate check is refused, here as on every other migrate command.
  const run = spawnSync("pnpm", ["--filter", "@sin/api", "exec", "node", "scripts/owner-env.mjs", "prisma", "migrate", "status"], {
    env: process.env,
    encoding: "utf8",
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const status = classifyMigrateStatus(output, run.status ?? 1);
  process.stdout.write(scrubDatabaseUrls(output, [owner.url, process.env.DATABASE_URL]));
  if (status.ok) {
    process.stdout.write(`\ncheck-migrate-status: ok (${status.state})\n`);
    return;
  }
  process.stderr.write(`\ncheck-migrate-status: refused (${status.state}) — run the migration by hand (runbook), then re-dispatch\n`);
  process.exit(1);
}

main();
