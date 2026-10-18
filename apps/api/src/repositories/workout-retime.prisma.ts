/**
 * Spec 07.4 §6.5 / §6.6 — the SQL Change Time and the finish run inside `updateWorkout`'s transaction,
 * after the workout row lock. Set times are rewritten only through these; a shift or a clamp never
 * touches a set's `created_at` / `updated_at` (real write times).
 */
import { localDateFor, offsetMinutesForZone } from "@sin/core";
import type { RawClient } from "./set-entry.prisma.js";

/** The profile zone (IANA name), read only when a start change arrives without `tzOffsetMinutes`. */
export async function userTimezone(tx: RawClient, userId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ timezone: string }[]>`SELECT timezone FROM "user" WHERE id = ${userId}::uuid`;
  return rows[0]?.timezone ?? "UTC";
}

/** AC24 / D8: the calendar fields for a changed start — the sent offset, else the profile zone at that instant. */
export async function calendarFor(
  tx: RawClient,
  userId: string,
  startedAt: Date,
  tzOffsetMinutes: number | undefined,
): Promise<{ localDate: string; tzOffsetMinutes: number }> {
  const iso = startedAt.toISOString();
  const offset = tzOffsetMinutes ?? offsetMinutesForZone(iso, await userTimezone(tx, userId));
  return { localDate: localDateFor(iso, offset), tzOffsetMinutes: offset };
}

/** AC25: pull every out-of-span `completed_at` into `[started_at, ended_at]`. Matches no row for a normal workout. */
export async function clampSetTimes(tx: RawClient, workoutId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "set_entry" AS se
    SET completed_at = LEAST(GREATEST(se.completed_at, w.started_at), w.ended_at)
    FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
    WHERE se.workout_exercise_id = we.id AND we.workout_id = ${workoutId}::uuid AND w.ended_at IS NOT NULL
      AND (se.completed_at < w.started_at OR se.completed_at > w.ended_at)
  `;
}
