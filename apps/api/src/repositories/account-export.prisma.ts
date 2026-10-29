import { Prisma, type PrismaClient } from "@prisma/client";
import type { AccountExportRepository, AccountSnapshot, HevyExportLinkRecord } from "./account-export.js";
import { toHevyPair, type HevyPairRow } from "./hevy.prisma.js";
import type { HevySectionRule } from "@sin/core";
import { exerciseColumns, toExerciseRecord, type ExerciseDbRow } from "./exercise.prisma.js";
import { ROUTINE_WITH_ITEMS, toRoutine, type RoutineDbRow } from "./routine.prisma.js";
import { SET_ENTRY_COLUMNS, toSetRecord, type RawClient, type SetEntryDbRow } from "./set-entry.prisma.js";
import { toUserRecord } from "./user.prisma.js";
import {
  routineIsOneOffSql,
  WE_PLANNED_SETS,
  toWorkoutExerciseRecord,
  toWorkoutRecord,
  toWorkoutSectionRecord,
  workoutSectionsJson,
  type WorkoutDbRow,
  type WorkoutExerciseDbRow,
  type WorkoutSectionDbRow,
} from "./workout.prisma.js";
import type { SetEntryRecord, WorkoutDetailRecord, WorkoutExerciseDetailRecord } from "./workout.js";

/**
 * Spec 11 §6.2 / D7 — one read-only REPEATABLE READ transaction, seven bulk
 * statements keyed by user_id, assembled in memory. Every statement sees the
 * snapshot taken by the first, so a set logged or a workout deleted mid-export
 * is wholly in or wholly out (AC7). No per-workout queries (AC8).
 */

/** The export's workout row: the shared columns plus Spec 09.2's note snapshot and sections aggregate. */
interface WorkoutExportDbRow extends WorkoutDbRow {
  routine_notes_snapshot: string | null;
  sections: WorkoutSectionDbRow[];
  /** Spec 09.3 — the read path's `EXISTS`, so the export equals `GET /v1/workouts/{id}`. */
  routine_is_one_off: boolean;
}

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
          // Spec 19.0 AC35: the Hevy block rides on the clock statement, so AC8's count is unchanged. Pairs keep the
          // mapping read's order and row shape (`toHevyPair`); links include tombstones (`workout_id` NULL).
          const [clock] = await tx.$queryRaw<
            {
              exported_at: Date;
              pairs: HevyPairRow[];
              rules: { name: string; treatment: string }[];
              links: { workout_id: string | null; hevy_workout_id: string | null; origin: string; synced_at: string | null }[];
            }[]
          >`
            SELECT clock_timestamp() AS exported_at,
              (SELECT coalesce(json_agg(json_build_object(
                         'hevy_template_id', p.hevy_template_id, 'hevy_title', p.hevy_title, 'hevy_type', p.hevy_type,
                         'role', p.role, 'exercise_id', p.exercise_id::text, 'is_active', e.is_active,
                         'measure_rule', p.measure_rule, 'export_as', p.export_as)
                       ORDER BY lower(p.hevy_title), p.hevy_template_id), '[]'::json)
                 FROM "hevy_exercise_pair" p LEFT JOIN "exercise" e ON e.id = p.exercise_id
                WHERE p.user_id = ${userId}::uuid) AS pairs,
              (SELECT coalesce(json_agg(json_build_object('name', name, 'treatment', treatment) ORDER BY name_key), '[]'::json)
                 FROM "hevy_section_rule" WHERE user_id = ${userId}::uuid) AS rules,
              (SELECT coalesce(json_agg(json_build_object(
                         'workout_id', workout_id::text, 'hevy_workout_id', hevy_workout_id, 'origin', origin, 'synced_at', synced_at)
                       ORDER BY created_at, id), '[]'::json)
                 FROM "hevy_link" WHERE user_id = ${userId}::uuid) AS links`;
          const hevy = clock!;
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
          const exerciseRows = await tx.$queryRaw<ExerciseDbRow[]>`
            SELECT ${exerciseColumns()}
            FROM "exercise" WHERE owner_user_id = ${userId}::uuid
            ORDER BY created_at, id`;
          await hooks.afterExercises?.(tx);
          const routineRows = await tx.$queryRaw<RoutineDbRow[]>(
            ROUTINE_WITH_ITEMS(Prisma.sql`r.user_id = ${userId}::uuid`, Prisma.sql`ORDER BY lower(r.name), r.id`),
          );
          const workoutRows = await tx.$queryRaw<WorkoutExportDbRow[]>`
            SELECT id, user_id, title, notes, started_at, ended_at, local_date,
                   tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s,
                   routine_notes_snapshot, ${workoutSectionsJson('"workout".id')} AS sections,
                   ${routineIsOneOffSql('"workout"')} AS routine_is_one_off
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
            routineNotes: w.routine_notes_snapshot,
            sections: w.sections.map(toWorkoutSectionRecord),
            routineIsOneOff: w.routine_is_one_off,
          }));
          const mapping = {
            pairs: hevy.pairs.map(toHevyPair),
            sectionRules: hevy.rules.map((r) => ({ name: r.name, treatment: r.treatment as HevySectionRule["treatment"] })),
          };
          const links = hevy.links.map((l) => ({ ...l, synced_at: l.synced_at === null ? null : new Date(l.synced_at) }));
          return {
            exportedAt: clock!.exported_at,
            user: toUserRecord(user),
            exercises: exerciseRows.map(toExerciseRecord),
            routines: routineRows.map(toRoutine),
            workouts,
            hevy: {
              pairs: mapping.pairs,
              sectionRules: mapping.sectionRules,
              links: links.map((l) => ({
                workoutId: l.workout_id,
                hevyWorkoutId: l.hevy_workout_id,
                origin: l.origin as HevyExportLinkRecord["origin"],
                syncedAt: l.synced_at,
              })),
            },
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
