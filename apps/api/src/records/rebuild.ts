/**
 * Spec 07.0 §6.5 — rebuild `personal_record` from `set_entry`, per user, with
 * the same recompute and the same lock as the live finish/delete path (D8,
 * D11). One transaction per user keeps each lock short and bounds memory.
 */
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { RawClient } from "../repositories/set-entry.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../repositories/personal-record.prisma.js";

export interface RebuildSummary {
  users: number;
  records: number;
}

/**
 * One user's rebuild, on the caller's transaction. Precondition: the caller already holds `lockUserRecords(tx, userId)`.
 * Shared by `records:rebuild` and the Hevy import finish (Spec 19.1 AC26).
 */
export async function rebuildUserRecords(tx: RawClient, userId: string): Promise<{ rootCount: number; recordCount: number }> {
  // Roots with history ∪ roots with rows: the second half removes stale rows.
  const rootRows = await tx.$queryRaw<{ root_id: string }[]>`
    SELECT DISTINCT COALESCE(e.forked_from_exercise_id, e.id)::text AS root_id
    FROM "workout" w
    JOIN "workout_exercise" we ON we.workout_id = w.id
    JOIN "exercise" e ON e.id = we.exercise_id
    WHERE w.user_id = ${userId}::uuid AND w.ended_at IS NOT NULL
    UNION
    SELECT exercise_id::text FROM "personal_record" WHERE user_id = ${userId}::uuid
  `;
  const roots = rootRows.map((r) => r.root_id);
  const written = await recomputeRecordsForRoots(tx, userId, roots);
  return { rootCount: roots.length, recordCount: written.length };
}

export async function rebuildRecords(
  prisma: PrismaClient,
  log: Logger,
  opts: { userId?: string },
): Promise<RebuildSummary> {
  const userId = opts.userId ?? null;
  // Every user with a finished workout, plus every user who still has rows
  // (so a user whose last finished workout vanished gets cleaned up too).
  const users = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT u.user_id::text AS user_id FROM (
      SELECT user_id FROM "workout" WHERE ended_at IS NOT NULL
      UNION
      SELECT user_id FROM "personal_record"
    ) u
    WHERE ${userId}::uuid IS NULL OR u.user_id = ${userId}::uuid
    ORDER BY 1
  `;
  if (users.length === 0 && userId !== null) log.info({ user_id: userId }, "records_rebuild_no_such_user");

  let records = 0;
  for (const { user_id } of users) {
    records += await prisma.$transaction(
      async (tx) => {
        await lockUserRecords(tx, user_id);
        const { rootCount, recordCount } = await rebuildUserRecords(tx, user_id);
        log.info({ user_id, root_count: rootCount, record_count: recordCount }, "records_rebuilt");
        return recordCount;
      },
      // Prisma's interactive-transaction default is 5 s; a long history needs more (like the seed).
      { timeout: 60_000 },
    );
  }
  return { users: users.length, records };
}
