import type { PrismaClient } from "@prisma/client";
import type { RawClient } from "./set-entry.prisma.js";
import type { OneOffOutcome } from "./workout.js";

/**
 * Spec 09.3 — every statement that removes or keeps a one-off routine lives here, so the guard
 * `user_id = $acting AND one_off_until IS NOT NULL` is written in one module.
 */

/**
 * §6.1 — the lazy expiry sweep, run by `list` (and, inside its own transaction, by `create`). With nothing
 * sweepable it is one read and opens no transaction (AC21). An expired one-off a live workout holds is not
 * sweepable, so the probe skips it too: a list read during that workout takes no lock on it. The delete below
 * still re-checks under the lock. Returns how many routines it removed.
 */
export async function sweepExpiredOneOffs(prisma: PrismaClient, userId: string): Promise<number> {
  const probe = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "routine" r
    WHERE r.user_id = ${userId}::uuid AND r.one_off_until IS NOT NULL AND r.one_off_until <= now()
      AND NOT EXISTS (SELECT 1 FROM "workout" w WHERE w.routine_id = r.id AND w.ended_at IS NULL)
    LIMIT 1
  `;
  if (probe.length === 0) return 0;
  return prisma.$transaction((tx) => deleteExpiredOneOffs(tx, userId));
}

/**
 * §6.1 steps 2 and 3, inside the caller's transaction. Locks the expired candidates `FOR UPDATE SKIP LOCKED`
 * (a routine someone is using right now is skipped, never waited for), then — as a SECOND statement, so it
 * sees every start committed before the locks were granted — deletes those with no live workout. A single
 * `DELETE … NOT EXISTS` would test the subquery against an older snapshot and could null a just-started
 * workout's `routine_id` (D9).
 */
export async function deleteExpiredOneOffs(tx: RawClient, userId: string): Promise<number> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "routine"
    WHERE user_id = ${userId}::uuid AND one_off_until IS NOT NULL AND one_off_until <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  `;
  if (locked.length === 0) return 0;
  const removed = await tx.$queryRaw<{ id: string }[]>`
    DELETE FROM "routine" r
    WHERE r.id = ANY(${locked.map((row) => row.id)}::uuid[])
      AND r.user_id = ${userId}::uuid
      AND r.one_off_until IS NOT NULL
      AND r.one_off_until <= now()
      AND NOT EXISTS (SELECT 1 FROM "workout" w WHERE w.routine_id = r.id AND w.ended_at IS NULL)
    RETURNING r.id
  `;
  return removed.length;
}

/**
 * §6.2 step 2 — on a live finish, after the PR lock and BEFORE the workout row lock: lock the workout's routine
 * row iff it is a one-off. The hand `DELETE /v1/routines/{id}` holds routine → workout (the FK's SET NULL), so
 * the finish must take them in that order too (D10). An ordinary routine, a manual workout and a re-finish
 * (`ended_at IS NULL` fails) match no row and lock nothing. Returns the routine id, or null.
 */
export async function lockOneOffForFinish(tx: RawClient, userId: string, workoutId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "routine" r
    WHERE r.id = (SELECT w.routine_id FROM "workout" w
                  WHERE w.id = ${workoutId}::uuid AND w.user_id = ${userId}::uuid AND w.ended_at IS NULL)
      AND r.user_id = ${userId}::uuid AND r.one_off_until IS NOT NULL
    FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

/**
 * §6.2 step 4 — after the finish UPDATE and the record recompute, so any earlier failure leaves the routine
 * alone (AC15): keep clears the mark, otherwise the routine is deleted (its children cascade, and this
 * workout's `routine_id` goes NULL). Both repeat the guard, so an ordinary routine is never touched (AC14).
 */
export async function settleOneOff(tx: RawClient, userId: string, routineId: string, keep: boolean): Promise<OneOffOutcome> {
  if (keep) {
    const kept = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "routine" SET one_off_until = NULL, updated_at = now()
      WHERE id = ${routineId}::uuid AND user_id = ${userId}::uuid AND one_off_until IS NOT NULL
      RETURNING id
    `;
    return kept.length > 0 ? "kept" : "none";
  }
  const removed = await tx.$queryRaw<{ id: string }[]>`
    DELETE FROM "routine"
    WHERE id = ${routineId}::uuid AND user_id = ${userId}::uuid AND one_off_until IS NOT NULL
    RETURNING id
  `;
  return removed.length > 0 ? "removed" : "none";
}

/** §6.4 — Keep: clear the mark if it is still set. True iff a row changed (the caller decides 204 vs 404). */
export async function keepOneOff(client: RawClient, userId: string, routineId: string): Promise<boolean> {
  return (await settleOneOff(client, userId, routineId, true)) === "kept";
}
