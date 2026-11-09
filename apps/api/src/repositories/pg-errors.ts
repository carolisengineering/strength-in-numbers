// apps/api/src/repositories/pg-errors.ts
/**
 * Raw-query Postgres error helpers shared by the repositories that decide a
 * 409 by a unique index rather than a read-then-write (Spec 05.0 D40, Spec 09
 * §6.3).
 *
 * A 23505 can't say which index it hit: `$queryRaw`'s error mapping never surfaces the constraint name, and for a role
 * under row-level security Postgres also omits the `Key (...)=(...)` DETAIL, so `meta.message` is empty of it (Spec 21.1
 * §6.7). Never read that text. Keep the catch around one statement that can reach only one such index, or ask a follow-up
 * question after the rollback.
 */

export interface RawPrismaError extends Error {
  code?: string;
  meta?: { code?: string; message?: string };
}

/** The driver SQLSTATE of an error a raw query surfaced through `$queryRaw` /
 * `$executeRaw` (`P2010` + `meta.code`; Spec 05.0 D40 pins this shape), else
 * `null` — the one place that shape is read (minor 159). */
export function rawSqlState(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const e = err as RawPrismaError;
  return e.code === "P2010" ? (e.meta?.code ?? null) : null;
}

const CAUSE_DEPTH = 5;

/**
 * Spec 21.1 §9 — a `42501` from the database, found on the error or down its `cause` chain (at most 5 deep): a missing
 * grant ("permission denied for table x") or a policy refusing a row ("… row-level security policy for table "x"").
 * `null` for anything else.
 */
export function rlsViolation(err: unknown): { sqlstate: string; table: string | null } | null {
  let current = err;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (rawSqlState(current) === "42501") {
      const message = (current as RawPrismaError).meta?.message ?? current.message;
      return { sqlstate: "42501", table: /for table "?([a-z_]+)"?/.exec(message)?.[1] ?? null };
    }
    current = current.cause;
  }
  return null;
}

/** True for a raw-query unique-violation (SQLSTATE `23505`) — distinct from
 * the typed client's `P2002` + `meta.target`. */
export function isRawUniqueViolation(err: unknown): err is RawPrismaError {
  return rawSqlState(err) === "23505";
}
