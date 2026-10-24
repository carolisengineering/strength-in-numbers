/**
 * Spec 15 AC15 — classify `prisma migrate status` output (pure). The phrases are Prisma's own, taken from the
 * captured runs in `test/fixtures/migrate-status/`. A database that is only *ahead* of the checkout (a rollback)
 * is reported by Prisma as "up to date", so it passes; ahead and pending at once reports both lists and is pending.
 */
export type MigrateStatus =
  | { ok: true; state: "up-to-date" | "db-ahead" }
  | { ok: false; state: "pending" | "failed" | "unreachable" | "unknown" };

export function classifyMigrateStatus(output: string, exitCode: number): MigrateStatus {
  if (/P1001|Can't reach database server/.test(output)) return { ok: false, state: "unreachable" };
  if (/have failed/.test(output)) return { ok: false, state: "failed" };
  if (/have not yet been applied/.test(output)) return { ok: false, state: "pending" };
  if (exitCode === 0 && /Database schema is up to date/.test(output)) {
    return { ok: true, state: /not found locally/.test(output) ? "db-ahead" : "up-to-date" };
  }
  return { ok: false, state: "unknown" };
}

/** Spec 15 §7: remove everything that identifies the database (the URL, host:port, hostname, password) before printing. */
export function scrubDatabaseUrl(text: string, databaseUrl: string): string {
  const secrets = [databaseUrl];
  try {
    const url = new URL(databaseUrl);
    secrets.push(url.host, url.hostname);
    if (url.password) secrets.push(url.password);
  } catch {
    // not a URL: the raw value is still removed
  }
  return secrets
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((out, s) => out.split(s).join("<redacted>"), text);
}
