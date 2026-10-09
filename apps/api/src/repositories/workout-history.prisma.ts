// apps/api/src/repositories/workout-history.prisma.ts
import { Prisma } from "@prisma/client";
import { parseWeightKgMilli, sumVolumeMilli, WORKOUT_SUMMARY_NAMES_MAX } from "@sin/core";
import { decodeWorkoutCursor, encodeWorkoutCursor } from "./workout-cursor.js";
import type { RawClient } from "./set-entry.prisma.js";
import type { ListFinishedWorkoutsOptions, WorkoutHistoryPage, WorkoutSummaryRecord } from "./workout.js";

/**
 * Spec 07.1 §6.1 — the history list: a keyset page query with correlated
 * subqueries, then one query for the page's working sets, whose volume is
 * summed in @sin/core (one definition of volume, D1/D4). Two statements, no
 * wrapping transaction (D12): finished workouts are immutable, so the only
 * race is a delete, which at worst yields a row with totalVolume null.
 */

interface PageRow {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: Date;
  ended_at: Date | null;
  local_date: Date;
  tz_offset_minutes: number;
  client_generated_id: string;
  source: string;
  created_at: Date;
  updated_at: Date;
  routine_name_snapshot: string | null;
  started_at_text: string;
  exercise_count: number;
  exercise_names: string[];
  working_set_count: number;
  record_count: number;
}

interface VolumeRow {
  workout_id: string;
  modality_snapshot: string;
  reps: number | null;
  weight_kg: string | null;
}

export async function listFinishedWorkouts(
  client: RawClient,
  actingUserId: string,
  opts: ListFinishedWorkoutsOptions,
): Promise<WorkoutHistoryPage> {
  // Decode first: a malformed cursor is a 422 before any query (AC7).
  const cursor = opts.cursor === undefined ? null : decodeWorkoutCursor(opts.cursor);
  // D13: the plain `<=` on the leading key is index-sargable; the row
  // comparison is what makes the boundary exact.
  const after = cursor
    ? Prisma.sql`AND w.started_at <= ${cursor.startedAtText}::timestamptz
                 AND (w.started_at, w.id) < (${cursor.startedAtText}::timestamptz, ${cursor.id}::uuid)`
    : Prisma.empty;

  const rows = await client.$queryRaw<PageRow[]>`
    SELECT w.id, w.user_id, w.title, w.notes, w.started_at, w.ended_at, w.local_date,
           w.tz_offset_minutes, w.client_generated_id, w.source, w.created_at, w.updated_at,
           w.routine_name_snapshot,
           to_char(w.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at_text,
           (SELECT count(*)::int FROM "workout_exercise" we WHERE we.workout_id = w.id) AS exercise_count,
           ARRAY(SELECT we.exercise_name_snapshot FROM "workout_exercise" we
                  WHERE we.workout_id = w.id ORDER BY we.position
                  LIMIT ${WORKOUT_SUMMARY_NAMES_MAX}) AS exercise_names,
           (SELECT count(*)::int FROM "set_entry" se
              JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
             WHERE we.workout_id = w.id AND se.set_type = 'working') AS working_set_count,
           (SELECT count(*)::int FROM "personal_record" pr WHERE pr.workout_id = w.id) AS record_count
    FROM "workout" w
    WHERE w.user_id = ${actingUserId}::uuid
      AND w.ended_at IS NOT NULL
      ${after}
    ORDER BY w.started_at DESC, w.id DESC
    LIMIT ${opts.limit + 1}
  `;

  // limit + 1 rows back proves another page exists; `next` is built from the
  // last RETURNED row, and the extra row is dropped (AC4).
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;

  const volumes = new Map<string, number | null>();
  if (page.length > 0) {
    const ids = page.map((r) => r.id);
    const sets = await client.$queryRaw<VolumeRow[]>`
      SELECT we.workout_id::text AS workout_id, we.modality_snapshot, se.reps, se.weight_kg::text AS weight_kg
      FROM "set_entry" se
      JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
      WHERE we.workout_id = ANY(${ids}::uuid[]) AND se.set_type = 'working'
    `;
    // No modality / weight filter in SQL: eligibility has one definition, setVolumeMilli (D4).
    const byWorkout = new Map<string, { modality: string; weightKgMilli: number | null; reps: number | null }[]>();
    for (const s of sets) {
      const entry = {
        modality: s.modality_snapshot,
        weightKgMilli: s.weight_kg === null ? null : parseWeightKgMilli(s.weight_kg),
        reps: s.reps,
      };
      const list = byWorkout.get(s.workout_id);
      if (list) list.push(entry);
      else byWorkout.set(s.workout_id, [entry]);
    }
    for (const [id, list] of byWorkout) volumes.set(id, sumVolumeMilli(list));
  }

  const items: WorkoutSummaryRecord[] = page.map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    notes: r.notes,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    localDate: r.local_date.toISOString().slice(0, 10),
    tzOffsetMinutes: r.tz_offset_minutes,
    clientGeneratedId: r.client_generated_id,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    routineName: r.routine_name_snapshot,
    exerciseCount: r.exercise_count,
    exerciseNames: r.exercise_names,
    workingSetCount: r.working_set_count,
    totalVolumeMilli: volumes.get(r.id) ?? null,
    recordCount: r.record_count,
  }));
  const last = page[page.length - 1];
  return {
    items,
    next: hasMore && last ? encodeWorkoutCursor({ startedAtText: last.started_at_text, id: last.id }) : null,
  };
}
