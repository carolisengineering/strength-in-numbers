// apps/api/src/repositories/personal-record.prisma.ts
import { computeRecords, milliToDecimalString, parseWeightKgMilli, type RecordSet } from "@sin/core";
import { uuidv7 } from "uuidv7";
import type { PersonalRecordRecord } from "./personal-record.js";
import type { RawClient } from "./set-entry.prisma.js";

/**
 * Spec 07.0 §6.3 — the one recompute shared by finish, delete and
 * `records:rebuild` (D8). Raw SQL like the other repositories.
 */

/** Per-user PR advisory lock (D9). Callers on the finish/delete paths take
 * the workout row lock FIRST — lock order is row → this, everywhere. */
export async function lockUserRecords(client: RawClient, userId: string): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pr:${userId}`}))`;
}

/** The distinct lineage roots a workout's exercises belong to (§6.2). */
export async function rootsForWorkout(client: RawClient, workoutId: string): Promise<string[]> {
  const rows = await client.$queryRaw<{ root_id: string }[]>`
    SELECT DISTINCT COALESCE(e.forked_from_exercise_id, e.id)::text AS root_id
    FROM "workout_exercise" we
    JOIN "exercise" e ON e.id = we.exercise_id
    WHERE we.workout_id = ${workoutId}::uuid
  `;
  return rows.map((r) => r.root_id);
}

interface LoaderRow {
  root_id: string;
  set_id: string;
  reps: number | null;
  weight_kg: string | null;
  modality_snapshot: string;
  source_exercise_id: string;
  exercise_name_snapshot: string;
  workout_id: string;
  started_at: Date;
  local_date: Date;
}

/** Through the decimal string, so the number equals what Postgres
 * `numeric::float8` gives on the read path — the finish response and the GET
 * agree (§6.7). */
const milliToNumber = (milli: number): number => Number(milliToDecimalString(milli));

/**
 * For each root: load its full qualifying history (working sets of the
 * user's finished workouts — `is_complete` deliberately ignored, D5), run
 * `computeRecords`, and replace the root's rows. Returns the rows written.
 * The caller must hold `lockUserRecords`.
 */
export async function recomputeRecordsForRoots(
  client: RawClient,
  userId: string,
  roots: readonly string[],
): Promise<PersonalRecordRecord[]> {
  if (roots.length === 0) return [];
  const rootList = [...roots];

  const rows = await client.$queryRaw<LoaderRow[]>`
    SELECT root.id::text AS root_id, se.id::text AS set_id, se.reps,
           se.weight_kg::text AS weight_kg, we.modality_snapshot,
           we.exercise_id::text AS source_exercise_id, we.exercise_name_snapshot,
           w.id::text AS workout_id, w.started_at, w.local_date
    FROM "set_entry" se
    JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
    JOIN "workout" w           ON w.id = we.workout_id
                              AND w.user_id = ${userId}::uuid AND w.ended_at IS NOT NULL
    JOIN "exercise" e          ON e.id = we.exercise_id
    CROSS JOIN LATERAL (SELECT COALESCE(e.forked_from_exercise_id, e.id) AS id) root
    WHERE se.set_type = 'working' AND root.id = ANY(${rootList}::uuid[])
    ORDER BY root.id, w.started_at, w.id, we.position, se.set_number
  `;

  await client.$executeRaw`
    DELETE FROM "personal_record"
    WHERE user_id = ${userId}::uuid AND exercise_id = ANY(${rootList}::uuid[])
  `;

  const byRoot = new Map<string, LoaderRow[]>();
  for (const row of rows) {
    const group = byRoot.get(row.root_id);
    if (group) group.push(row);
    else byRoot.set(row.root_id, [row]);
  }

  const written: PersonalRecordRecord[] = [];
  for (const [rootId, group] of byRoot) {
    const bySetId = new Map(group.map((r) => [r.set_id, r]));
    const sets: RecordSet[] = group.map((r) => ({
      setId: r.set_id,
      workoutId: r.workout_id,
      modality: r.modality_snapshot,
      weightKgMilli: r.weight_kg === null ? null : parseWeightKgMilli(r.weight_kg),
      reps: r.reps,
    }));
    for (const c of computeRecords(sets)) {
      const src = bySetId.get(c.setId)!;
      const localDate = src.local_date.toISOString().slice(0, 10);
      const previous = c.previousValueMilli === null ? null : milliToDecimalString(c.previousValueMilli);
      await client.$executeRaw`
        INSERT INTO "personal_record"
          ("id", "user_id", "exercise_id", "record_type", "value", "unit", "previous_value",
           "source_set_entry_id", "workout_id", "achieved_at", "local_date")
        VALUES (${uuidv7()}::uuid, ${userId}::uuid, ${rootId}::uuid, ${c.recordType},
                ${milliToDecimalString(c.valueMilli)}::numeric, ${c.unit}, ${previous}::numeric,
                ${c.setId}::uuid, ${c.workoutId}::uuid, ${src.started_at}, ${localDate}::date)
      `;
      written.push({
        exerciseId: rootId,
        sourceExerciseId: src.source_exercise_id,
        exerciseName: src.exercise_name_snapshot,
        recordType: c.recordType,
        value: milliToNumber(c.valueMilli),
        unit: c.unit,
        previousValue: c.previousValueMilli === null ? null : milliToNumber(c.previousValueMilli),
        sourceSetId: c.setId,
        workoutId: c.workoutId,
        achievedAt: src.started_at,
        localDate,
      });
    }
  }
  return written;
}
