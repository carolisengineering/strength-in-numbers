// apps/api/src/repositories/personal-record.prisma.ts
import {
  computeRecords,
  milliToDecimalString,
  parseWeightKgMilli,
  progressPoints,
  type RecordSet,
  type RecordType,
  type RecordUnit,
} from "@sin/core";
import { Prisma } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import type {
  PersonalRecordFilter,
  PersonalRecordRecord,
  PersonalRecordRepository,
  ProgressRange,
  ProgressSeriesRecord,
} from "./personal-record.js";
import type { RawClient } from "./set-entry.prisma.js";
import { NotFoundError } from "../errors/app-error.js";

/**
 * Spec 07.0 §6.3 — the one recompute shared by finish, delete and
 * `records:rebuild` (D8). Raw SQL like the other repositories.
 */

/** Per-user PR advisory lock (D9, amended). Every PR writer takes this as its
 * FIRST statement, before any workout row lock: the recompute's INSERTs take FK
 * KEY SHARE locks on other workouts' rows, so a writer holding a row lock while
 * waiting for this one can deadlock (AC18). */
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

export interface LineageSetRow {
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

export interface LineageRange {
  from?: string | undefined;
  to?: string | undefined;
}

/** Inclusive `local_date` bounds as bound parameters; `Prisma.empty` when
 * unbounded, so the recompute's statement is byte-for-byte what it was (07.2 AC15). */
export function lineageRangeSql(range: LineageRange): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (range.from !== undefined) parts.push(Prisma.sql`AND w.local_date >= ${range.from}::date`);
  if (range.to !== undefined) parts.push(Prisma.sql`AND w.local_date <= ${range.to}::date`);
  return parts.length === 0 ? Prisma.empty : Prisma.join(parts, " ");
}

/** A visible exercise (global, or owned by the caller — retired included) →
 * its lineage root; null otherwise (07.0 §6.7, shared since Spec 07.2). */
export async function resolveVisibleRoot(client: RawClient, userId: string, exerciseId: string): Promise<string | null> {
  const r = await client.$queryRaw<{ root_id: string }[]>`
    SELECT COALESCE(forked_from_exercise_id, id)::text AS root_id FROM "exercise"
    WHERE id = ${exerciseId}::uuid
      AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)
  `;
  return r[0]?.root_id ?? null;
}

/**
 * 07.0 §6.3's loader, shared since Spec 07.2: the user's working sets of
 * finished workouts in the given lineages, ordered (root, started_at, workout
 * id, position, set_number), grouped by root. `is_complete` is ignored (07.0 D5).
 */
export async function loadLineageSets(
  client: RawClient,
  userId: string,
  roots: readonly string[],
  range: LineageRange = {},
): Promise<Map<string, LineageSetRow[]>> {
  const byRoot = new Map<string, LineageSetRow[]>();
  if (roots.length === 0) return byRoot;
  const rootList = [...roots];
  const rows = await client.$queryRaw<LineageSetRow[]>`
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
      ${lineageRangeSql(range)}
    ORDER BY root.id, w.started_at, w.id, we.position, se.set_number
  `;
  for (const row of rows) {
    const group = byRoot.get(row.root_id);
    if (group) group.push(row);
    else byRoot.set(row.root_id, [row]);
  }
  return byRoot;
}

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

  const byRoot = await loadLineageSets(client, userId, rootList);

  await client.$executeRaw`
    DELETE FROM "personal_record"
    WHERE user_id = ${userId}::uuid AND exercise_id = ANY(${rootList}::uuid[])
  `;

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

interface ReadRow {
  exercise_id: string;
  source_exercise_id: string;
  exercise_name: string;
  record_type: string;
  value: number;
  unit: string;
  previous_value: number | null;
  source_set_id: string;
  workout_id: string;
  achieved_at: Date;
  local_date: Date;
}

/** Spec 07.0 §6.7 — the read half. Always `WHERE user_id = actingUserId`. */
export function createPersonalRecordRepository(prisma: RawClient): PersonalRecordRepository {
  return {
    async list(actingUserId: string, filter: PersonalRecordFilter): Promise<PersonalRecordRecord[]> {
      let root: string | null = null;
      if (filter.exerciseId !== undefined) {
        // Resolve only through exercises the caller may see (global or owned,
        // retired included) — anything else matches nothing (§7, AC20).
        root = await resolveVisibleRoot(prisma, actingUserId, filter.exerciseId);
        if (root === null) return [];
      }
      const workoutId = filter.workoutId ?? null;
      const rows = await prisma.$queryRaw<ReadRow[]>`
        SELECT pr.exercise_id::text AS exercise_id, we.exercise_id::text AS source_exercise_id,
               we.exercise_name_snapshot AS exercise_name, pr.record_type,
               pr.value::float8 AS value, pr.unit, pr.previous_value::float8 AS previous_value,
               pr.source_set_entry_id::text AS source_set_id, pr.workout_id::text AS workout_id,
               pr.achieved_at, pr.local_date
        FROM "personal_record" pr
        JOIN "set_entry" se        ON se.id = pr.source_set_entry_id
        JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
        WHERE pr.user_id = ${actingUserId}::uuid
          AND (${root}::uuid IS NULL OR pr.exercise_id = ${root}::uuid)
          AND (${workoutId}::uuid IS NULL OR pr.workout_id = ${workoutId}::uuid)
        ORDER BY pr.achieved_at DESC, pr.workout_id, pr.exercise_id, pr.record_type
      `;
      return rows.map((r) => ({
        exerciseId: r.exercise_id,
        sourceExerciseId: r.source_exercise_id,
        exerciseName: r.exercise_name,
        recordType: r.record_type as RecordType,
        value: r.value,
        unit: r.unit as RecordUnit,
        previousValue: r.previous_value,
        sourceSetId: r.source_set_id,
        workoutId: r.workout_id,
        achievedAt: r.achieved_at,
        localDate: r.local_date.toISOString().slice(0, 10),
      }));
    },
    async getProgressSeries(actingUserId: string, exerciseId: string, range: ProgressRange): Promise<ProgressSeriesRecord> {
      const root = await resolveVisibleRoot(prisma, actingUserId, exerciseId);
      if (root === null) throw new NotFoundError("exercise not found or not visible to the acting user");
      const rows = (await loadLineageSets(prisma, actingUserId, [root], range)).get(root) ?? [];
      const firstRowOf = new Map<string, LineageSetRow>();
      for (const r of rows) if (!firstRowOf.has(r.workout_id)) firstRowOf.set(r.workout_id, r);
      const points = progressPoints(
        rows.map((r) => ({
          setId: r.set_id,
          workoutId: r.workout_id,
          modality: r.modality_snapshot,
          weightKgMilli: r.weight_kg === null ? null : parseWeightKgMilli(r.weight_kg),
          reps: r.reps,
        })),
      ).map((p) => {
        const row = firstRowOf.get(p.workoutId)!;
        return { ...p, localDate: row.local_date.toISOString().slice(0, 10), startedAt: row.started_at };
      });
      return { exerciseId: root, points };
    },
  };
}
