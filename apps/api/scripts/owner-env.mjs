// apps/api/scripts/owner-env.mjs
/**
 * Spec 21.1 §6.8 (AC28) — runs a command (the repo-pinned Prisma CLI) with `DATABASE_URL` set from `OWNER_DATABASE_URL`,
 * for the child process only: `prisma/schema.prisma` reads `env("DATABASE_URL")`, and `.env` now holds the restricted
 * login, which cannot migrate.
 *
 *   node --env-file-if-exists=.env.owner scripts/owner-env.mjs prisma migrate status
 *
 * Plain `.mjs`: it runs before anything is compiled. `prisma` is found because `pnpm run` / `pnpm exec` put it on PATH.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The same text as `OWNER_URL_MISSING` in `src/db/owner-url.ts`; `owner-env.test.ts` pins them equal. */
export const OWNER_URL_MISSING = "set OWNER_DATABASE_URL to the owner login; DATABASE_URL is the application login and cannot migrate";

/** Never includes the URL: a malformed one may hold the password. */
export const OWNER_URL_NOT_STRICT =
  "OWNER_DATABASE_URL must carry sslmode=require&sslaccept=strict (sslmode=disable only on a local database): the Prisma CLI reads the raw URL, and without them the owner login would connect with no certificate check (runbook B1)";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);
export const OWNER_URL_MALFORMED = "OWNER_DATABASE_URL is not a valid URL (percent-encode any / : @ in the password)";

/**
 * The child's environment, or the refusal. The given object (the real process's environment) is never changed. The app
 * and the maintenance CLIs backfill `sslaccept=strict` (`resolveDatabaseUrl`); the Prisma CLI does not (#8), and it treats
 * any `sslmode` but `require` / `disable`, including libpq's `verify-full`, as TLS optional (`db.ts`).
 */
export function resolveOwnerEnv(env) {
  const raw = env.OWNER_DATABASE_URL;
  if (raw === undefined || raw === "") return { ok: false, error: OWNER_URL_MISSING };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: OWNER_URL_MALFORMED };
  }
  const sslmode = url.searchParams.get("sslmode");
  const verified = sslmode === "require" && url.searchParams.get("sslaccept") === "strict";
  const local = sslmode === "disable" && LOCAL_HOSTS.has(url.hostname);
  if (!verified && !local) return { ok: false, error: OWNER_URL_NOT_STRICT };
  return { ok: true, env: { ...env, DATABASE_URL: raw } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === undefined) {
    process.stderr.write("usage: owner-env.mjs <command> [args…]\n");
    process.exit(1);
  }
  const resolved = resolveOwnerEnv(process.env);
  if (!resolved.ok) {
    process.stderr.write(`${resolved.error}\n`);
    process.exit(1);
  }
  const run = spawnSync(cmd, args, { stdio: "inherit", env: resolved.env });
  if (run.error) process.stderr.write(`owner-env: could not run ${cmd}: ${run.error.code ?? run.error.message}\n`);
  process.exit(run.status ?? 1);
}
