// apps/api/src/repositories/set-entry.prisma.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { isWorkoutExerciseId, type Modality } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError } from "../errors/app-error.js";
import { assertSetMeasuresValid, fieldsToMeasures } from "./set-writes.js";
import type { CreateSetFields, CreateSetResult, SetEntryRecord, WorkoutRepository } from "./workout.js";

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

    async updateSet(): Promise<SetEntryRecord> {
      throw new Error("updateSet: Task 5");
    },
    async deleteSet(): Promise<void> {
      throw new Error("deleteSet: Task 5");
    },
  };
}
