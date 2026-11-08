// apps/api/src/repositories/pg-errors.ts
/**
 * Raw-query Postgres error helpers shared by the repositories that decide a
 * 409 by a unique index rather than a read-then-write (Spec 05.0 D40, Spec 09
 * §6.3). Moved here from `workout.prisma.ts` verbatim; the key-column parse is
 * generalised so an expression index (`Key (user_id, lower(name))=…`) parses.
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

/**
 * Against a real driver, `meta.message` on this error path is only the
 * DETAIL line (`Key (col[, col...])=(val[, val...]) already exists.`) — the
 * primary message that names the constraint (`duplicate key value violates
 * unique constraint "…"`) is not surfaced through `$queryRaw`'s error
 * mapping, so the constraint can't be identified by name here. It's
 * identified by column list instead: the INSERT's `ON CONFLICT (user_id,
 * client_generated_id) DO NOTHING` already suppresses `workout_user_client_id_key`
 * violations without raising, so the only unique index left that can throw
 * from this statement is the single-column partial index
 * `workout_user_active_key` (on `user_id`, `WHERE ended_at IS NULL`) — its
 * violation's DETAIL always lists exactly `user_id`. Spec 09's
 * `routine_user_name_key` is an expression index, so its DETAIL reads
 * `Key (user_id, lower(name))=(…)`: the column list is everything up to the
 * first `)=(`, which keeps nested parentheses intact.
 */
export function violatedConstraintColumns(err: RawPrismaError): string | null {
  const match = /^Key \((.+?)\)=\(/.exec(err.meta?.message ?? "");
  return match?.[1]?.trim() ?? null;
}
