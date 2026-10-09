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

/** True for a raw-query unique-violation surfaced through `$queryRaw`
 * (`P2010` + driver SQLSTATE `23505` in `meta` — distinct from the typed
 * client's `P2002` + `meta.target`; Spec 05.0 D40 pins this shape). */
export function isRawUniqueViolation(err: unknown): err is RawPrismaError {
  return (
    err instanceof Error &&
    (err as RawPrismaError).code === "P2010" &&
    (err as RawPrismaError).meta?.code === "23505"
  );
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
