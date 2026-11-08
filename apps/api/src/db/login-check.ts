// apps/api/src/db/login-check.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { ConfigError } from "../config.js";
import { rawSqlState } from "../repositories/pg-errors.js";

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

/**
 * Gave up after the retries. One fixed line that keeps only Prisma's code, not its message, which names the host (Spec 15
 * §7). The client's own `log` option still prints a `prisma:error` line for each failed attempt, as it does for any
 * database error while the API runs.
 */
export class DatabaseUnreachableError extends ConfigError {
  constructor(seconds: number, detail: string) {
    const message = `Refusing to start: could not reach the database within ${seconds} s (${detail}).`;
    super([message]);
    this.message = message;
  }
}

const DEADLINE_MS = 20_000;
const FIRST_DELAY_MS = 250;
const MAX_DELAY_MS = 4_000;
const CAUSE_DEPTH = 5;
const REJECTED_SQLSTATES = new Set(["28000", "28P01"]);
const CONNECTIVITY_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
/** A server restarting or still starting: terminated by an administrator, crash shutdown, cannot connect now. */
const TRANSIENT_SQLSTATES = new Set(["57P01", "57P02", "57P03"]);
/** Prisma 6.19 gives these no error code through $queryRaw: wrong password or no password ("Authentication failed…"), and a
 * NOLOGIN role that has a password ("User was denied access…"). login-check.integration.test.ts pins both on a real server. */
const REJECTED_LOGIN_TEXT = /Authentication failed against database server|User was denied access on the database/;

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
  if (err instanceof Prisma.PrismaClientInitializationError && REJECTED_LOGIN_TEXT.test(err.message)) return true;
  for (const e of chain(err)) {
    const { code, errorCode } = e as { code?: unknown; errorCode?: unknown };
    if (code === "P1000" || errorCode === "P1000") return true;
    // A raw query's SQLSTATE through rawSqlState; a driver error in a `cause` carries it as its own `code`.
    for (const state of [rawSqlState(e), code]) if (typeof state === "string" && REJECTED_SQLSTATES.has(state)) return true;
  }
  return false;
}

/** What a give-up line may say about the error: its Prisma code or class, never its message. */
function errorDetail(err: unknown): string {
  const { code, errorCode } = err as { code?: unknown; errorCode?: unknown };
  if (typeof code === "string") return code;
  if (typeof errorCode === "string") return errorCode;
  return (err as object).constructor.name;
}

/** Rejects when the attempt outlives the budget left, so a stalled connection cannot hang the boot past its deadline. */
class AttemptTimedOut extends Error {}
function withinBudget<T>(attempt: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimedOut()), ms);
  });
  return Promise.race([attempt, expired]).finally(() => clearTimeout(timer));
}

function isConnectivity(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  const state = rawSqlState(err);
  if (state !== null && TRANSIENT_SQLSTATES.has(state)) return true;
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
      facts = await withinBudget(readFacts(client), Math.max(deadlineMs - (now() - started), 1));
    } catch (err) {
      if (err instanceof AttemptTimedOut) throw new DatabaseUnreachableError(Math.round(deadlineMs / 1000), "timed out");
      if (isRejectedLogin(err)) throw new DatabaseLoginRejectedError();
      if (!isConnectivity(err)) throw err;
      if (now() + delay - started > deadlineMs) throw new DatabaseUnreachableError(Math.round(deadlineMs / 1000), errorDetail(err));
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      continue;
    }
    const reason = unsafeReason(facts);
    if (reason !== null) throw new UnsafeDatabaseLoginError(facts, reason);
    return facts;
  }
}
