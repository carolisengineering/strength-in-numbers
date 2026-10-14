import { Prisma, type PrismaClient } from "@prisma/client";
import type { AccountExportRepository, AccountSnapshot } from "./account-export.js";
import { toExerciseRecord, type ExerciseDbRow } from "./exercise.prisma.js";
import { ROUTINE_WITH_ITEMS, toRoutine, type RoutineDbRow } from "./routine.prisma.js";
import { SET_ENTRY_COLUMNS, toSetRecord, type RawClient, type SetEntryDbRow } from "./set-entry.prisma.js";
import { toUserRecord } from "./user.prisma.js";
import {
  WE_PLANNED_SETS,
  toWorkoutExerciseRecord,
  toWorkoutRecord,
  type WorkoutDbRow,
  type WorkoutExerciseDbRow,
} from "./workout.prisma.js";
import type { SetEntryRecord, WorkoutDetailRecord, WorkoutExerciseDetailRecord } from "./workout.js";

/**
 * Spec 11 §6.2 / D7 — one read-only REPEATABLE READ transaction, seven bulk
 * statements keyed by user_id, assembled in memory. Every statement sees the
 * snapshot taken by the first, so a set logged or a workout deleted mid-export
 * is wholly in or wholly out (AC7). No per-workout queries (AC8).
 */

export interface AccountExportHooks {
  /** Tests only (AC7): runs inside the transaction after statement 3. */
  afterExercises?: (tx: RawClient) => Promise<void>;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export function createAccountExportRepository(
  prisma: PrismaClient,
  hooks: AccountExportHooks = {},
): AccountExportRepository {
  return {
    snapshot(userId: string): Promise<AccountSnapshot> {
      return prisma.$transaction(
        async (tx) => {
          // D7: must precede the first data statement. If Prisma's own
          // isolation SET makes this fail, drop it and keep the AC7 probe.
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          const [clock] = await tx.$queryRaw<{ exported_at: Date }[]>`SELECT clock_timestamp() AS exported_at`;
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
          const exerciseRows = await tx.$queryRaw<ExerciseDbRow[]>`
            SELECT id, catalog_key, owner_user_id, name, modality, primary_muscle_id,
                   secondary_muscle_ids, equipment_id, is_active, forked_from_exercise_id,
                   created_at, updated_at
            FROM "exercise" WHERE owner_user_id = ${userId}::uuid
            ORDER BY created_at, id`;
          await hooks.afterExercises?.(tx);
          const routineRows = await tx.$queryRaw<RoutineDbRow[]>(
            ROUTINE_WITH_ITEMS(Prisma.sql`r.user_id = ${userId}::uuid`, Prisma.sql`ORDER BY lower(r.name), r.id`),
          );
          const workoutRows = await tx.$queryRaw<WorkoutDbRow[]>`
            SELECT id, user_id, title, notes, started_at, ended_at, local_date,
                   tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot
            FROM "workout" WHERE user_id = ${userId}::uuid
            ORDER BY started_at, id`;
          const exerciseOfWorkoutRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
            SELECT id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, notes,
                   created_at, updated_at, target_sets, target_reps_low, target_reps_high, target_rpe,
                   rest_seconds, superset_group, section_id, ${WE_PLANNED_SETS} AS planned_sets
            FROM "workout_exercise"
            WHERE workout_id IN (SELECT id FROM "workout" WHERE user_id = ${userId}::uuid)
            ORDER BY workout_id, position`;
          const setRows = await tx.$queryRaw<SetEntryDbRow[]>`
            SELECT ${SET_ENTRY_COLUMNS} FROM "set_entry"
            WHERE workout_exercise_id IN (
              SELECT we.id FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
              WHERE w.user_id = ${userId}::uuid)
            ORDER BY workout_exercise_id, set_number`;

          const setsByExercise = groupBy<SetEntryRecord>(setRows.map(toSetRecord), (s) => s.workoutExerciseId);
          const exercisesByWorkout = groupBy(exerciseOfWorkoutRows.map(toWorkoutExerciseRecord), (e) => e.workoutId);
          const workouts: WorkoutDetailRecord[] = workoutRows.map((w) => ({
            ...toWorkoutRecord(w),
            exercises: (exercisesByWorkout.get(w.id) ?? []).map(
              (e): WorkoutExerciseDetailRecord => ({ ...e, sets: setsByExercise.get(e.id) ?? [] }),
            ),
            // Interim until Task 7 (Spec 09.2 D13) reads the snapshot columns here.
            routineNotes: null,
            sections: [],
          }));
          return {
            exportedAt: clock!.exported_at,
            user: toUserRecord(user),
            exercises: exerciseRows.map(toExerciseRecord),
            routines: routineRows.map(toRoutine),
            workouts,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 30_000,
          maxWait: 5_000,
        },
      );
    },
  };
}
