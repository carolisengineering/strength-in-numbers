/**
 * Spec 11 §6.4 — hard-delete accounts soft-deleted more than
 * ACCOUNT_PURGE_GRACE_DAYS ago. Dry run unless `confirm`. One transaction per
 * account: `lockUserRecords` first (the cascade deletes personal_record rows,
 * D13), then the DELETE with the grace check INSIDE its predicate, so an
 * account restored after the listing is safe and a live account
 * (deleted_at IS NULL) can never match (AC26, AC27). Logs ids and counts only.
 */
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { ACCOUNT_PURGE_GRACE_DAYS } from "@sin/core";
import { lockUserRecords } from "../repositories/personal-record.prisma.js";
import type { RawClient } from "../repositories/set-entry.prisma.js";

export type SkipReason = "not-eligible" | "not-found" | "not-deleted" | "in-grace";

export interface EligibleAccount {
  userId: string;
  deletedAt: Date;
  workoutCount: number;
  setCount: number;
}

export interface PurgeOptions {
  confirm: boolean;
  userId?: string;
  skipGrace: boolean;
}

/** Tests only (AC27, AC29): runs inside each account's transaction, before the DELETE. */
export interface PurgeHooks {
  beforeDelete?: (userId: string) => Promise<void>;
}

export interface PurgeSummary {
  dryRun: boolean;
  listed: EligibleAccount[];
  purged: number;
  skipped: number;
  failed: number;
  /** `--user` was given and that account was not purged (dry run: not listed). */
  targetMissed: boolean;
}

/** D10: exact seconds, bound as a parameter; `--skip-grace` is 0. */
export function graceSecondsFor(skipGrace: boolean): number {
  return skipGrace ? 0 : ACCOUNT_PURGE_GRACE_DAYS * 86_400;
}

export async function listEligible(
  client: RawClient,
  graceSeconds: number,
  userId: string | null,
): Promise<EligibleAccount[]> {
  const rows = await client.$queryRaw<{ id: string; deleted_at: Date; workouts: number; sets: number }[]>`
    SELECT u.id::text AS id, u.deleted_at,
           (SELECT count(*) FROM "workout" w WHERE w.user_id = u.id)::int AS workouts,
           (SELECT count(*) FROM "set_entry" s
              JOIN "workout_exercise" we ON we.id = s.workout_exercise_id
              JOIN "workout" w ON w.id = we.workout_id
             WHERE w.user_id = u.id)::int AS sets
    FROM "user" u
    WHERE u.deleted_at IS NOT NULL
      AND u.deleted_at <= now() - make_interval(secs => ${graceSeconds}::float8)
      AND (${userId}::uuid IS NULL OR u.id = ${userId}::uuid)
    ORDER BY u.deleted_at, u.id
  `;
  return rows.map((r) => ({ userId: r.id, deletedAt: r.deleted_at, workoutCount: r.workouts, setCount: r.sets }));
}

/** Why a `--user` target was not listed. */
export async function classifyTarget(client: RawClient, userId: string, graceSeconds: number): Promise<SkipReason> {
  const rows = await client.$queryRaw<{ deleted_at: Date | null; in_grace: boolean | null }[]>`
    SELECT deleted_at, deleted_at > now() - make_interval(secs => ${graceSeconds}::float8) AS in_grace
    FROM "user" WHERE id = ${userId}::uuid
  `;
  const row = rows[0];
  if (!row) return "not-found";
  if (row.deleted_at === null) return "not-deleted";
  return row.in_grace ? "in-grace" : "not-eligible";
}

export async function purgeAccount(
  prisma: PrismaClient,
  userId: string,
  graceSeconds: number,
  hooks: PurgeHooks = {},
): Promise<{ purged: boolean; workoutCount: number; setCount: number }> {
  return prisma.$transaction(
    async (tx) => {
      await lockUserRecords(tx, userId); // FIRST statement (D13, AC22)
      const [counts] = await tx.$queryRaw<{ workouts: number; sets: number }[]>`
        SELECT (SELECT count(*) FROM "workout" WHERE user_id = ${userId}::uuid)::int AS workouts,
               (SELECT count(*) FROM "set_entry" s
                  JOIN "workout_exercise" we ON we.id = s.workout_exercise_id
                  JOIN "workout" w ON w.id = we.workout_id
                 WHERE w.user_id = ${userId}::uuid)::int AS sets
      `;
      await hooks.beforeDelete?.(userId);
      const deleted = await tx.$executeRaw`
        DELETE FROM "user"
        WHERE id = ${userId}::uuid
          AND deleted_at IS NOT NULL
          AND deleted_at <= now() - make_interval(secs => ${graceSeconds}::float8)
      `;
      return { purged: deleted === 1, workoutCount: counts!.workouts, setCount: counts!.sets };
    },
    // Prisma's interactive-transaction default is 5 s; a long history cascades more.
    { timeout: 60_000 },
  );
}

export async function runPurge(
  prisma: PrismaClient,
  log: Logger,
  opts: PurgeOptions,
  hooks: PurgeHooks = {},
): Promise<PurgeSummary> {
  const graceSeconds = graceSecondsFor(opts.skipGrace);
  const listed = await listEligible(prisma, graceSeconds, opts.userId ?? null);
  const summary: PurgeSummary = { dryRun: !opts.confirm, listed, purged: 0, skipped: 0, failed: 0, targetMissed: false };

  for (const a of listed) {
    log.info(
      { user_id: a.userId, deleted_at: a.deletedAt.toISOString(), workout_count: a.workoutCount, set_count: a.setCount },
      "account_purge_eligible",
    );
  }
  if (opts.userId !== undefined && listed.length === 0) {
    const reason = await classifyTarget(prisma, opts.userId, graceSeconds);
    log.info({ user_id: opts.userId, reason }, "account_purge_skipped");
    summary.skipped += 1;
    summary.targetMissed = true;
  }

  if (opts.confirm) {
    for (const a of listed) {
      try {
        const r = await purgeAccount(prisma, a.userId, graceSeconds, hooks);
        if (r.purged) {
          summary.purged += 1;
          log.info(
            { user_id: a.userId, workout_count: r.workoutCount, set_count: r.setCount, skip_grace: opts.skipGrace },
            "account_purged",
          );
        } else {
          summary.skipped += 1;
          if (opts.userId !== undefined) summary.targetMissed = true;
          log.info({ user_id: a.userId, reason: "not-eligible" }, "account_purge_skipped");
        }
      } catch (err) {
        // D11: roll back this account, keep going. The class, not the message
        // (a message could echo SQL parameters).
        summary.failed += 1;
        log.error({ user_id: a.userId, error_class: (err as Error)?.constructor?.name ?? typeof err }, "account_purge_failed");
      }
    }
  }

  log.info(
    { purged: summary.purged, skipped: summary.skipped, failed: summary.failed, dry_run: summary.dryRun },
    `purged ${summary.purged}, skipped ${summary.skipped}, failed ${summary.failed}`,
  );
  return summary;
}
