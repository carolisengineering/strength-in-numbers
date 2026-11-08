// apps/api/src/db/login-check.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { ConfigError } from "../config.js";

/**
 * Spec 21.1 §6.4 (D5, AC24, AC26) — the boot refusal. The API runs this on its own pool, after `createPrisma` and before
 * `listen`, and will not start on a login that could bypass row-level security: a superuser, `BYPASSRLS`, the owner of
 * an application table, a member of a role that is any of those, or a login with `row_security = off`.
 *
 * There is no opt-out: no variable, flag or `NODE_ENV` branch skips it. A connection error is not a verdict, so it is
 * retried for up to 20 s (Cloud Run's startup budget is 30 s, and Neon may be waking up); a verdict fails at once. It
 * deliberately does not check that RLS is enabled: the rollout and the kill switch need windows with it off.
 */

export interface LoginFacts {
  role: string;
  superuser: boolean;
  bypassrls: boolean;
  ownsTables: boolean;
  /** Roles this login could `SET ROLE` into that can bypass RLS. Only roles it is a member OF, never its own members. */
  memberOfBypass: string[];
  rowSecurity: boolean;
  /** Wall time of the successful attempt. */
  ms: number;
}

export class UnsafeDatabaseLoginError extends ConfigError {
  readonly facts: LoginFacts;
  readonly reason: string;

  constructor(facts: LoginFacts, reason: string) {
    super([reason]);
    this.facts = facts;
    this.reason = reason;
    // The whole message is this one line (startupFailureMessage prints it alone). Never the URL, the host or a password.
    this.message = `Refusing to start: the database login "${facts.role}" can bypass row-level security (${reason}). The API must connect as the restricted application login (see docs/runbooks/first-deploy.md, RLS rollout). Maintenance commands use OWNER_DATABASE_URL.`;
  }
}

const LOGIN_REJECTED =
  "Refusing to start: the database rejected the login (authentication failed or login not permitted). On a fresh database give the restricted login its password: pnpm --filter @sin/api run db:app-role (docs/runbooks/first-deploy.md, RLS rollout).";

export class DatabaseLoginRejectedError extends ConfigError {
  constructor() {
    super([LOGIN_REJECTED]);
    this.message = LOGIN_REJECTED;
  }
}

const DEADLINE_MS = 20_000;
const FIRST_DELAY_MS = 250;
const MAX_DELAY_MS = 4_000;
const CAUSE_DEPTH = 5;
const REJECTED_SQLSTATES = new Set(["28000", "28P01"]);
const CONNECTIVITY_CODES = new Set(["P1001", "P1002", "P1017"]);

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  owns_table: boolean;
}

type Client = Pick<PrismaClient, "$queryRaw">;

async function readFacts(client: Client): Promise<LoginFacts> {
  const started = performance.now();
  const login = await client.$queryRaw<RoleRow[]>`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls,
           EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relowner = r.oid) AS owns_table
    FROM pg_roles r WHERE r.rolname = current_user`;
  // Any role this login could SET ROLE into (a member directly or through other roles; INHERIT does not matter for
  // SET ROLE). pg_has_role reads "current_user is a member of r", so Postgres 16's creator grant, which makes another
  // role a member of sin_app, is not a hit.
  const members = await client.$queryRaw<RoleRow[]>`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls,
           EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relowner = r.oid) AS owns_table
    FROM pg_roles r
    WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')
      AND (r.rolsuper OR r.rolbypassrls OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relowner = r.oid))
    ORDER BY r.rolname`;
  const rowSecurity = await client.$queryRaw<{ row_security: string }[]>`SELECT current_setting('row_security') AS row_security`;
  const me = login[0]!;
  return {
    role: me.rolname,
    superuser: me.rolsuper,
    bypassrls: me.rolbypassrls,
    ownsTables: me.owns_table,
    memberOfBypass: members.map((m) => m.rolname),
    rowSecurity: rowSecurity[0]!.row_security === "on",
    ms: Math.round(performance.now() - started),
  };
}

/** The first reason in the fixed order, or `null` for a safe login. */
function unsafeReason(f: LoginFacts): string | null {
  if (f.superuser) return "superuser";
  if (f.bypassrls) return "has BYPASSRLS";
  if (f.ownsTables) return "owns application tables";
  const role = f.memberOfBypass[0];
  if (role !== undefined) return `can SET ROLE to "${role}"`;
  if (!f.rowSecurity) return "row_security is off";
  return null;
}

/** The error and its `cause` chain, at most `CAUSE_DEPTH` deep. */
function* chain(err: unknown): Generator<unknown> {
  let current: unknown = err;
  for (let depth = 0; depth < CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

function isRejectedLogin(err: unknown): boolean {
  // Prisma 6.19 raises this for a NOLOGIN role and for a wrong password alike, with no error code: only the text says
  // so (login-check.integration.test.ts pins it against a real server).
  if (err instanceof Prisma.PrismaClientInitializationError && /Authentication failed against database server/.test(err.message)) return true;
  for (const e of chain(err)) {
    const { code, errorCode, meta } = e as { code?: unknown; errorCode?: unknown; meta?: { code?: unknown } };
    if (code === "P1000" || errorCode === "P1000") return true;
    for (const state of [code, meta?.code]) if (typeof state === "string" && REJECTED_SQLSTATES.has(state)) return true;
  }
  return false;
}

function isConnectivity(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && CONNECTIVITY_CODES.has(err.code);
}

export async function assertLoginCannotBypassRls(
  client: Client,
  opts: { deadlineMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<LoginFacts> {
  const deadlineMs = opts.deadlineMs ?? DEADLINE_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let delay = FIRST_DELAY_MS;
  for (;;) {
    let facts: LoginFacts;
    try {
      facts = await readFacts(client);
    } catch (err) {
      if (isRejectedLogin(err)) throw new DatabaseLoginRejectedError();
      if (!isConnectivity(err)) throw err;
      if (now() + delay - started > deadlineMs) throw err;
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      continue;
    }
    const reason = unsafeReason(facts);
    if (reason !== null) throw new UnsafeDatabaseLoginError(facts, reason);
    return facts;
  }
}
