import type { PrismaClient } from "@prisma/client";
import type { RawClient } from "./set-entry.prisma.js";

/**
 * Spec 09.3 — every statement that removes or keeps a one-off routine lives here, so the guard
 * `user_id = $acting AND one_off_until IS NOT NULL` is written in one module.
 */

/**
 * §6.1 — the lazy expiry sweep, run by `list` (and, inside its own transaction, by `create`). With nothing
 * expired it is one read and opens no transaction (AC21). Returns how many routines it removed.
 */
export async function sweepExpiredOneOffs(prisma: PrismaClient, userId: string): Promise<number> {
  const probe = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "routine"
    WHERE user_id = ${userId}::uuid AND one_off_until IS NOT NULL AND one_off_until <= now()
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
