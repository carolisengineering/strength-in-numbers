// apps/api/src/db/owner-url.ts
/**
 * Spec 21.1 §6.8 (D4) — every command that migrates or acts across users reads `OWNER_DATABASE_URL`, never
 * `DATABASE_URL`: after the switch `DATABASE_URL` is the restricted application login, which the API holds and which
 * cannot migrate. The API refuses to hold the owner URL (`loadConfig`), and these commands refuse to substitute the other
 * one, so "which login" is a property of the command rather than of a runbook sentence.
 *
 * No `@prisma/client` import: `deploy-prod` runs `check-migrate-status.ts` with no generated client.
 *
 * Minor 416: the one place the maintenance commands read and resolve the owner URL, and the one safe-logging rule for it.
 */
import { resolveDatabaseUrl } from "./database-url.js";

/** `scripts/owner-env.mjs` carries the same text; `owner-env.test.ts` pins them equal. */
export const OWNER_URL_MISSING = "set OWNER_DATABASE_URL to the owner login; DATABASE_URL is the application login and cannot migrate";

/** An empty value counts as missing: a blank left in a form or an `.env` file carries no credential. */
export function ownerDatabaseUrl(env: Record<string, string | undefined>): { ok: true; url: string } | { ok: false; error: string } {
  const url = env.OWNER_DATABASE_URL;
  return url === undefined || url === "" ? { ok: false, error: OWNER_URL_MISSING } : { ok: true, url };
}

/**
 * Minor 441: the hosts a maintenance command treats as this machine's database. `URL.hostname` gives IPv6 loopback as
 * `[::1]` (never a bare `::1`), and `db` is the compose service. `scripts/owner-env.mjs` keeps a copy (it can't import
 * TypeScript); `owner-env.test.ts` pins them equal.
 */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

/** An error's text with every secret replaced: the message of a failed connect or statement may quote either. */
export function redacted(err: unknown, secrets: readonly string[]): string {
  const name = (err as Error)?.constructor?.name ?? typeof err;
  let message = err instanceof Error ? err.message : String(err);
  // Longest first, so a whole URL goes before its password would break the match (scrubDatabaseUrl does the same).
  for (const s of [...secrets].filter((x) => x.length > 0).sort((a, b) => b.length - a.length)) message = message.split(s).join("***");
  return `${name}: ${message.split("\n").filter((l) => l.trim() !== "").slice(-3).join(" ")}`;
}

export type OwnerUrl =
  | { ok: true; url: string; hostname: string; secrets: string[] }
  | {
      ok: false;
      error: string;
      /** For pino: never `{ err }`, because a malformed URL's TypeError carries the raw string in an enumerable `input`. */
      fields?: { error_class: string; reason: string };
      /** For a plain-text command: the error, redacted (`redacted`). */
      detail?: string;
    };

/** `OWNER_DATABASE_URL`, read and resolved (`resolveDatabaseUrl`: TLS and pool backfill) in one call. */
export function resolveOwnerUrl(env: Record<string, string | undefined>): OwnerUrl {
  const owner = ownerDatabaseUrl(env);
  if (!owner.ok) return owner;
  try {
    const url = resolveDatabaseUrl(owner.url);
    const parsed = new URL(url);
    const secrets = [owner.url, url, parsed.password, decodedOrRaw(parsed.password), parsed.host, parsed.hostname];
    return { ok: true, url, hostname: parsed.hostname, secrets };
  } catch (err) {
    return {
      ok: false,
      error: "OWNER_DATABASE_URL rejected",
      fields: { error_class: (err as Error)?.constructor?.name ?? typeof err, reason: redactedMessage(err, owner.url) },
      detail: redacted(err, [owner.url]),
    };
  }
}

/**
 * The password percent-decoded for the secrets list, or as written when it isn't valid percent-encoding: resolving the
 * URL never refused such a password, so listing a secret mustn't start to (final review, minor 416).
 */
function decodedOrRaw(password: string): string {
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
}

/** The error's message with the raw URL (and so its password) taken out, in case a parser ever quotes it. */
function redactedMessage(err: unknown, raw: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return raw === "" ? message : message.split(raw).join("***");
}
