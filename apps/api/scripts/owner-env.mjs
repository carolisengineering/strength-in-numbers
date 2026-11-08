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

/** The child's environment, or the refusal. The given object (the real process's environment) is never changed. */
export function resolveOwnerEnv(env) {
  const url = env.OWNER_DATABASE_URL;
  if (url === undefined || url === "") return { ok: false, error: OWNER_URL_MISSING };
  return { ok: true, env: { ...env, DATABASE_URL: url } };
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
