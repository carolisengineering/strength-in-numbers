// apps/api/src/db/scoped.ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { isUserId, type UserId } from "@sin/core";

/**
 * Spec 21.1 §6.1 (D1) — "who is asking" on every database call.
 *
 * Every repository method starts with `const c = db.as(actingUserId)` and runs its statements on `c`:
 * - a bare `c.$queryRaw` / `c.$executeRaw` becomes Prisma's sequential batch `[set_config, statement]` (one connection,
 *   `BEGIN` … `COMMIT`: 4 statements instead of 1);
 * - `c.$transaction(fn, opts)` is an interactive transaction whose first statement is `set_config` (after
 *   `SET TRANSACTION READ ONLY` when `readOnly`), and `fn` gets the ordinary transaction client, so every helper that
 *   takes a `RawClient` is unchanged (+1 statement).
 *
 * The setting is always transaction-local (`is_local = true`): it ends with the transaction, so a pooled connection
 * never carries one user's id into another's call. `shared()` is the root client, only for the shared reference tables
 * and statements that read no table; the query audit (Spec 21.0) holds the list.
 *
 * Until Phase C nothing reads `app.user_id` / `app.auth_sub`, so this changes no behavior.
 */

/** The raw half of a Prisma client: what every SQL helper takes (moved here from `set-entry.prisma.ts`). */
export type RawClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export interface ScopedTxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** `SET TRANSACTION READ ONLY` as the first statement, before `set_config` (Spec 11 D7's snapshot order). */
  readOnly?: boolean;
  maxWait?: number;
  timeout?: number;
}

export interface ScopedClient extends RawClient {
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opts?: ScopedTxOptions): Promise<T>;
}

/**
 * Who is asking: an unbranded string (the repositories' `actingUserId`) or a `UserId`, never another id brand, so an
 * `ExerciseId` passed by mistake does not type-check. The shape is checked again at runtime.
 */
type UserIdBrandKey = Exclude<keyof UserId, keyof string>;
export type ActingUserId = string & Partial<Pick<UserId, UserIdBrandKey>>;

export interface UserScopedDb {
  /** A client whose every statement runs with `app.user_id` set. Throws on a malformed id, before any call. */
  as(userId: ActingUserId): ScopedClient;
  /** Provisioning only (§6.3): `app.auth_sub` instead, for the lookup and insert keyed on the token's subject. */
  forAuthSub(authSub: string): ScopedClient;
  /** The root client, unscoped: the shared reference tables and statements that read no table, nothing else. */
  shared(): RawClient;
  /** False for a bare `PrismaClient` wrapped by `toScoped` (tests and maintenance scripts on the owner login). */
  readonly scoped: boolean;
}

type RawArgs = [query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]];

const USER_SETTING = "app.user_id";
const AUTH_SUB_SETTING = "app.auth_sub";

function checkedUserId(userId: string): string {
  if (!isUserId(userId)) throw new TypeError("scoped database handle: the acting user id is not a uuid");
  return userId;
}

function checkedAuthSub(authSub: string): string {
  if (authSub.length === 0) throw new TypeError("scoped database handle: empty auth_sub");
  return authSub;
}

/** Only the options the caller set, so Prisma's own defaults apply exactly as they did before (Review Focus 3). */
function rootTxOptions(opts: ScopedTxOptions | undefined): { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number } {
  const out: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number } = {};
  if (opts?.isolationLevel !== undefined) out.isolationLevel = opts.isolationLevel;
  if (opts?.maxWait !== undefined) out.maxWait = opts.maxWait;
  if (opts?.timeout !== undefined) out.timeout = opts.timeout;
  return out;
}

function setConfig(client: RawClient, setting: string, value: string) {
  return setting === USER_SETTING
    ? client.$queryRaw`SELECT set_config('app.user_id', ${value}, true)`
    : client.$queryRaw`SELECT set_config('app.auth_sub', ${value}, true)`;
}

function scopedClient(prisma: PrismaClient, setting: string, value: string): ScopedClient {
  const bare =
    (method: "$queryRaw" | "$executeRaw") =>
    (...args: RawArgs): Promise<unknown> => {
      const statement = (prisma[method] as (...a: RawArgs) => Prisma.PrismaPromise<unknown>)(...args);
      return prisma.$transaction([setConfig(prisma, setting, value), statement]).then((results) => results[1]);
    };
  return {
    $queryRaw: bare("$queryRaw") as unknown as RawClient["$queryRaw"],
    $executeRaw: bare("$executeRaw") as unknown as RawClient["$executeRaw"],
    $transaction: (fn, opts) =>
      prisma.$transaction(async (tx) => {
        if (opts?.readOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await setConfig(tx, setting, value);
        return fn(tx);
      }, rootTxOptions(opts)),
  };
}

/** The owner-login pass-through: no setting, but the same id check, `readOnly` and options as the scoped form. */
function unscopedClient(prisma: PrismaClient): ScopedClient {
  return {
    $queryRaw: ((...args: RawArgs) => (prisma.$queryRaw as (...a: RawArgs) => unknown)(...args)) as RawClient["$queryRaw"],
    $executeRaw: ((...args: RawArgs) => (prisma.$executeRaw as (...a: RawArgs) => unknown)(...args)) as RawClient["$executeRaw"],
    $transaction: (fn, opts) =>
      prisma.$transaction(async (tx) => {
        if (opts?.readOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return fn(tx);
      }, rootTxOptions(opts)),
  };
}

export function createScopedDb(prisma: PrismaClient): UserScopedDb {
  return {
    as: (userId) => scopedClient(prisma, USER_SETTING, checkedUserId(userId)),
    forAuthSub: (authSub) => scopedClient(prisma, AUTH_SUB_SETTING, checkedAuthSub(authSub)),
    shared: () => prisma,
    scoped: true,
  };
}

function isUserScopedDb(db: UserScopedDb | PrismaClient): db is UserScopedDb {
  return typeof (db as Partial<UserScopedDb>).as === "function" && typeof (db as Partial<UserScopedDb>).scoped === "boolean";
}

/**
 * What every repository factory calls on its argument: a scoped handle passes through; a bare `PrismaClient` (tests and
 * maintenance scripts, which run on the owner login where RLS never applies) becomes an unscoped handle that sends no
 * setting. `server.ts` passes only `createScopedDb(prisma)` (AC20).
 */
export function toScoped(db: UserScopedDb | PrismaClient): UserScopedDb {
  if (isUserScopedDb(db)) return db;
  const client = unscopedClient(db);
  return {
    as: (userId) => (checkedUserId(userId), client),
    forAuthSub: (authSub) => (checkedAuthSub(authSub), client),
    shared: () => db,
    scoped: false,
  };
}
