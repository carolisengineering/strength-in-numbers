// apps/api/src/db/owner-url.ts
/**
 * Spec 21.1 §6.8 (D4) — every command that migrates or acts across users reads `OWNER_DATABASE_URL`, never
 * `DATABASE_URL`: after the switch `DATABASE_URL` is the restricted application login, which the API holds and which
 * cannot migrate. The API refuses to hold the owner URL (`loadConfig`), and these commands refuse to substitute the other
 * one, so "which login" is a property of the command rather than of a runbook sentence.
 *
 * No `@prisma/client` import: `deploy-prod` runs `check-migrate-status.ts` with no generated client.
 */

/** `scripts/owner-env.mjs` carries the same text; `owner-env.test.ts` pins them equal. */
export const OWNER_URL_MISSING = "set OWNER_DATABASE_URL to the owner login; DATABASE_URL is the application login and cannot migrate";

/** An empty value counts as missing: a blank left in a form or an `.env` file carries no credential. */
export function ownerDatabaseUrl(env: Record<string, string | undefined>): { ok: true; url: string } | { ok: false; error: string } {
  const url = env.OWNER_DATABASE_URL;
  return url === undefined || url === "" ? { ok: false, error: OWNER_URL_MISSING } : { ok: true, url };
}
