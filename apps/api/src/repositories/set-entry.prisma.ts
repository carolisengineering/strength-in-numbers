// apps/api/src/repositories/set-entry.prisma.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { isSetEntryId, isWorkoutExerciseId, type Modality } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { IncompleteWorkingSetsError, NotFoundError, WorkoutFinishedError } from "../errors/app-error.js";
import { assertSetMeasuresValid, fieldsToMeasures, isWorkingSetComplete, mergeSetPatch } from "./set-writes.js";
import type {
  CreateSetFields,
  CreateSetResult,
  SetEntryRecord,
  UpdateSetFields,
  WorkoutRepository,
} from "./workout.js";

/**
 * Prisma-backed set methods for WorkoutRepository (Spec 05.1 §6), spread into
 * `createWorkoutRepository`'s returned object. Raw SQL, like the rest of
 * `workout.prisma.ts`. Lock order is always workout → workout_exercise →
 * set_entry, one statement each: the same order a whole-workout DELETE's
 * cascade takes them, so a concurrent delete can never deadlock against us.
 */

const WE_NOT_FOUND = "workout exercise not found or not owned by the acting user";

/** Every full-row read. `numeric` columns cast to float8 so they arrive as JS
 * numbers, not Prisma `Decimal`s. */
export const SET_ENTRY_COLUMNS = Prisma.sql`
  id, workout_exercise_id, set_number, set_type, reps,
  weight::float8 AS weight, weight_unit, weight_kg::float8 AS weight_kg,
  distance::float8 AS distance, distance_unit, distance_m::float8 AS distance_m,
  duration_s, rpe::float8 AS rpe, is_complete, completed_at, created_at, updated_at`;

export interface SetEntryDbRow {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  set_type: string;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null;
  weight_kg: number | null;
  distance: number | null;
  distance_unit: string | null;
  distance_m: number | null;
  duration_s: number | null;
  rpe: number | null;
  is_complete: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function toSetRecord(r: SetEntryDbRow): SetEntryRecord {
  return {
    id: r.id,
    workoutExerciseId: r.workout_exercise_id,
    setNumber: r.set_number,
    setType: r.set_type,
    reps: r.reps,
    weight: r.weight,
    weightUnit: r.weight_unit,
    weightKg: r.weight_kg,
    distance: r.distance,
    distanceUnit: r.distance_unit,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    rpe: r.rpe,
    isComplete: r.is_complete,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SET_NOT_FOUND = "set not found or not owned by the acting user";

export type RawClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/** Ownership through set_entry → workout_exercise → workout (a set carries
 * no user_id). No lock: workout_id and modality_snapshot never change. */
async function resolveOwnedSet(
  tx: RawClient,
  actingUserId: string,
  id: string,
): Promise<{ workout_id: string; modality_snapshot: string }> {
  const rows = await tx.$queryRaw<{ workout_id: string; modality_snapshot: string }[]>`
    SELECT we.workout_id, we.modality_snapshot
    FROM "set_entry" se
    JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
    JOIN "workout" w ON w.id = we.workout_id
    WHERE se.id = ${id}::uuid AND w.user_id = ${actingUserId}::uuid
  `;
  if (!rows[0]) throw new NotFoundError(SET_NOT_FOUND);
  return rows[0];
}

/** D10: the authoritative finished check for PATCH/DELETE, under FOR SHARE —
 * a concurrent finish (FOR UPDATE) either commits first and we see it, or
 * waits for us. Without it a set edit could land after the finish's
 * integrity check passed. */
async function assertWorkoutInProgress(tx: RawClient, workoutId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
    SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
  `;
  if (!rows[0]) throw new NotFoundError(SET_NOT_FOUND);
  if (rows[0].ended_at !== null) throw new WorkoutFinishedError();
}

/** AC12: every set of one workout, grouped by the caller. One query per detail
 * read, not one per exercise. */
export async function loadSetsForWorkout(client: RawClient, workoutId: string): Promise<SetEntryRecord[]> {
  const rows = await client.$queryRaw<SetEntryDbRow[]>`
    SELECT ${SET_ENTRY_COLUMNS} FROM "set_entry"
    WHERE workout_exercise_id IN (SELECT id FROM "workout_exercise" WHERE workout_id = ${workoutId}::uuid)
    ORDER BY workout_exercise_id, set_number
  `;
  return rows.map(toSetRecord);
}

/**
 * Spec 05.1 §6.5 — 05.0's Extension seam 1. Must run inside the finish
 * transaction, AFTER its FOR UPDATE lock on the workout row (D9): only then
 * has every concurrent set write on this workout either committed or backed
 * off, so this read can't miss one (AC21). warmup / drop / failure sets are
 * excluded by the WHERE and never inspected (AC14).
 */
export async function assertWorkingSetsComplete(client: RawClient, workoutId: string): Promise<void> {
  const rows = await client.$queryRaw<
    {
      modality_snapshot: string;
      reps: number | null;
      weight: number | null;
      distance: number | null;
      duration_s: number | null;
    }[]
  >`
    SELECT we.modality_snapshot, se.reps, se.weight::float8 AS weight,
           se.distance::float8 AS distance, se.duration_s
    FROM "workout_exercise" we
    JOIN "set_entry" se ON se.workout_exercise_id = we.id
    WHERE we.workout_id = ${workoutId}::uuid AND se.set_type = 'working'
  `;
  for (const r of rows) {
    const measures = { reps: r.reps, weight: r.weight, distance: r.distance, durationS: r.duration_s };
    if (!isWorkingSetComplete(r.modality_snapshot as Modality, measures)) {
      throw new IncompleteWorkingSetsError();
    }
  }
}

export function createSetEntryMethods(
  prisma: PrismaClient,
): Pick<WorkoutRepository, "createSet" | "updateSet" | "deleteSet"> {
  return {
    async createSet(
      actingUserId: string,
      workoutExerciseId: string,
      fields: CreateSetFields,
    ): Promise<CreateSetResult> {
      if (!isWorkoutExerciseId(workoutExerciseId)) throw new NotFoundError(WE_NOT_FOUND);

      // Phase 1 (§6.2 step 1): ownership through the join (a workout_exercise
      // carries no user_id), plus a cheap finished check on the root client.
      // The authoritative finished check is the FOR SHARE re-check below.
      const parents = await prisma.$queryRaw<
        { workout_id: string; modality_snapshot: string; ended_at: Date | null }[]
      >`
        SELECT we.workout_id, we.modality_snapshot, w.ended_at
        FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
        WHERE we.id = ${workoutExerciseId}::uuid AND w.user_id = ${actingUserId}::uuid
      `;
      const parent = parents[0];
      if (!parent) throw new NotFoundError(WE_NOT_FOUND);
      if (parent.ended_at !== null) throw new WorkoutFinishedError();

      // §6.1 point 2: validate the body as sent; no stored row to merge.
      const modality = parent.modality_snapshot as Modality;
      const next = fieldsToMeasures(fields);
      assertSetMeasuresValid(modality, next);

      const set = await prisma.$transaction(async (tx) => {
        // §6.3: the lock is its own first statement; the max read is a
        // separate, later statement (03.2 D23's snapshot trap).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workoutExerciseId}))`;
        // AC11: a concurrent finish holds FOR UPDATE on this row; we either
        // run before it or see its committed ended_at.
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${parent.workout_id}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) throw new NotFoundError(WE_NOT_FOUND);
        if (locked.ended_at !== null) throw new WorkoutFinishedError();
        // D10: hold the workout_exercise row so a concurrent
        // DELETE /v1/workout-exercises/{id} can't remove it before our INSERT
        // (which would be an FK-violation 500, not a 404).
        const weRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "workout_exercise" WHERE id = ${workoutExerciseId}::uuid FOR SHARE
        `;
        if (!weRows[0]) throw new NotFoundError(WE_NOT_FOUND);

        const maxRows = await tx.$queryRaw<{ max: number | null }[]>`
          SELECT max(set_number)::int AS max FROM "set_entry" WHERE workout_exercise_id = ${workoutExerciseId}::uuid
        `;
        const setNumber = (maxRows[0]?.max ?? 0) + 1;

        const inserted = await tx.$queryRaw<SetEntryDbRow[]>`
          INSERT INTO "set_entry"
            (id, workout_exercise_id, set_number, set_type, reps, weight, weight_unit,
             distance, distance_unit, duration_s, rpe, is_complete, completed_at, created_at, updated_at)
          VALUES
            (${uuidv7()}::uuid, ${workoutExerciseId}::uuid, ${setNumber}::smallint, ${next.setType},
             ${next.reps}::smallint, ${next.weight}::numeric, ${next.weightUnit},
             ${next.distance}::numeric, ${next.distanceUnit}, ${next.durationS}::integer,
             ${next.rpe}::numeric, ${next.isComplete}::boolean,
             CASE WHEN ${next.isComplete}::boolean THEN now() ELSE NULL END, now(), now())
          RETURNING ${SET_ENTRY_COLUMNS}
        `;
        return toSetRecord(inserted[0]!);
      });
      return { set, modalitySnapshot: modality };
    },

    async updateSet(actingUserId: string, id: string, patch: UpdateSetFields): Promise<SetEntryRecord> {
      if (!isSetEntryId(id)) throw new NotFoundError(SET_NOT_FOUND);
      return prisma.$transaction(async (tx) => {
        const owner = await resolveOwnedSet(tx, actingUserId, id);
        await assertWorkoutInProgress(tx, owner.workout_id);
        // FOR UPDATE: two concurrent patches of one set serialize, so each
        // merges onto what it actually overwrites.
        const storedRows = await tx.$queryRaw<SetEntryDbRow[]>`
          SELECT ${SET_ENTRY_COLUMNS} FROM "set_entry" WHERE id = ${id}::uuid FOR UPDATE
        `;
        if (!storedRows[0]) throw new NotFoundError(SET_NOT_FOUND);
        const next = mergeSetPatch(toSetRecord(storedRows[0]), patch);
        assertSetMeasuresValid(owner.modality_snapshot as Modality, next);

        // completed_at: stamped on the false→true transition, kept on a
        // repeated true, cleared on false (§5).
        const updated = await tx.$queryRaw<SetEntryDbRow[]>`
          UPDATE "set_entry"
          SET set_type = ${next.setType}, reps = ${next.reps}::smallint,
              weight = ${next.weight}::numeric, weight_unit = ${next.weightUnit},
              distance = ${next.distance}::numeric, distance_unit = ${next.distanceUnit},
              duration_s = ${next.durationS}::integer, rpe = ${next.rpe}::numeric,
              is_complete = ${next.isComplete}::boolean,
              completed_at = CASE WHEN ${next.isComplete}::boolean THEN COALESCE(completed_at, now()) ELSE NULL END,
              updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING ${SET_ENTRY_COLUMNS}
        `;
        return toSetRecord(updated[0]!);
      });
    },

    async deleteSet(actingUserId: string, id: string): Promise<void> {
      if (!isSetEntryId(id)) throw new NotFoundError(SET_NOT_FOUND);
      await prisma.$transaction(async (tx) => {
        const owner = await resolveOwnedSet(tx, actingUserId, id);
        await assertWorkoutInProgress(tx, owner.workout_id);
        // No renumbering: set_number is a permanent ordinal (D2, AC9).
        const affected = await tx.$executeRaw`DELETE FROM "set_entry" WHERE id = ${id}::uuid`;
        if (affected === 0) throw new NotFoundError(SET_NOT_FOUND);
      });
    },
  };
}
