// apps/api/src/repositories/workout.prisma.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { isWorkoutExerciseId, isWorkoutId, localDateFor, offsetMinutesForZone } from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  ExerciseRetiredError,
  InternalError,
  NotFoundError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
} from "../errors/app-error.js";
import type { ExerciseRepository } from "./exercise.js";
import { isRawUniqueViolation, violatedConstraintColumns } from "./pg-errors.js";
import { plannedSetsJson, toPlannedSet, type PlannedSetDbRow } from "./planned-sets.js";
import type {
  AddWorkoutExerciseFields,
  CreateWorkoutFields,
  CreateWorkoutResult,
  DeleteWorkoutResult,
  UpdateWorkoutExerciseFields,
  UpdateWorkoutFields,
  UpdateWorkoutResult,
  SetEntryRecord,
  WorkoutDetailRecord,
  WorkoutExerciseDetailRecord,
  WorkoutExerciseRecord,
  WithFinishedEdit,
  WorkoutRecord,
  WorkoutSectionRecord,
  WorkoutRepository,
} from "./workout.js";
import {
  assertAddPositionInRange,
  assertReorderPositionInRange,
  computeAppendPosition,
  retimeOrThrow,
  retimeOutcome,
} from "./workout-writes.js";
import { calendarFor, clampSetTimes, shiftSetTimes } from "./workout-retime.prisma.js";
import {
  assertWorkingSetsComplete,
  assertWouldNotEmpty,
  createSetEntryMethods,
  loadSetsForWorkout,
  type RawClient,
} from "./set-entry.prisma.js";
import type { PersonalRecordRecord } from "./personal-record.js";
import { lockOneOffForFinish, settleOneOff } from "./routine-one-off.prisma.js";
import {
  lockUserRecords,
  recomputeRecordsForRoots,
  rootOfWorkoutExercise,
  repeatedRootOfWorkoutExercise,
  rootsForWorkout,
} from "./personal-record.prisma.js";
import { assertStillLive, noRecompute, recomputeTimed, withWriteMode, type FinishedEdit } from "./write-mode.js";
import { listFinishedWorkouts as listFinishedWorkoutsQuery } from "./workout-history.prisma.js";

/**
 * Prisma-backed WorkoutRepository (Spec 05.0 §6, "Wiring points"). Raw SQL
 * throughout, mirroring `exercise.prisma.ts`: the partial unique index, the
 * deferred constraint and the advisory-lock idiom are not expressible via
 * Prisma's query builder.
 */

export interface WorkoutDbRow {
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
  /** Spec 07.4 §4 (migration 0012): NULL unless a live workout has a planned "took". */
  planned_duration_s: number | null;
}

function toRecord(r: WorkoutDbRow): WorkoutRecord {
  return {
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
    plannedDurationS: r.planned_duration_s ?? null,
  };
}

export interface WorkoutExerciseDbRow {
  id: string;
  workout_id: string;
  position: number;
  exercise_id: string;
  exercise_name_snapshot: string;
  modality_snapshot: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  target_sets: number | null;
  target_reps_low: number | null;
  target_reps_high: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  superset_group: number | null;
  /** Spec 09.1 — `json_agg` of the exercise's planned rows, `[]` when none. */
  planned_sets: PlannedSetDbRow[];
  section_id: string | null;
}

export interface WorkoutSectionDbRow {
  id: string;
  position: number;
  name: string;
  notes: string | null;
}

export function toWorkoutSectionRecord(r: WorkoutSectionDbRow): WorkoutSectionRecord {
  return { id: r.id, position: r.position, name: r.name, notes: r.notes };
}

/** Spec 09.2 §6.3 — a workout's sections as one scalar subquery (the `plannedSetsJson` idiom), so a
 * statement that already selects the workout stays one statement. `parentRef` is a SQL column
 * reference (`'w.id'`, `'"workout".id'`), never user input. */
export function workoutSectionsJson(parentRef: string): Prisma.Sql {
  return Prisma.raw(`COALESCE((
    SELECT json_agg(json_build_object('id', s.id, 'position', s.position, 'name', s.name, 'notes', s.notes)
                    ORDER BY s.position)
    FROM "workout_section" s WHERE s.workout_id = ${parentRef}
  ), '[]'::json)`);
}

/** Spec 09.3 §6.4 — true iff the workout's routine exists and is a one-off now. `workoutRef` is a SQL
 * column reference (`'w'`, `'"workout"'`), never user input. Used by the detail and the export. */
export function ROUTINE_IS_ONE_OFF(workoutRef: string): Prisma.Sql {
  return Prisma.raw(
    `EXISTS (SELECT 1 FROM "routine" r WHERE r.id = ${workoutRef}.routine_id AND r.one_off_until IS NOT NULL)`,
  );
}

/** A correlated sub-select over `"workout_exercise"` (Spec 09.1 §6.5). */
const WE_PLANNED_SETS = plannedSetsJson("workout_planned_set", "workout_exercise_id", '"workout_exercise".id');

function toExerciseRecord(r: WorkoutExerciseDbRow): WorkoutExerciseRecord {
  return {
    id: r.id,
    workoutId: r.workout_id,
    position: r.position,
    exerciseId: r.exercise_id,
    exerciseNameSnapshot: r.exercise_name_snapshot,
    modalitySnapshot: r.modality_snapshot,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    targetSets: r.target_sets,
    targetRepsLow: r.target_reps_low,
    targetRepsHigh: r.target_reps_high,
    targetRpeTenths: r.target_rpe,
    restSeconds: r.rest_seconds,
    supersetGroup: r.superset_group,
    plannedSets: r.planned_sets.map(toPlannedSet),
    sectionId: r.section_id,
  };
}

type InsertOutcome =
  | { kind: "inserted"; row: WorkoutDbRow; copiedCount: number; plannedSetCount: number; sectionCount: number }
  | { kind: "no-row" }
  | { kind: "active-conflict" };

/** Carries a non-`inserted` outcome out of the routine-start transaction so
 * Prisma rolls it back (a 23505 has already poisoned it) instead of
 * committing — the outer code then runs 05.0's re-read / retry rules
 * unchanged (Spec 09 §6.5 step 1). */
class StartOutcomeSignal extends Error {
  constructor(readonly outcome: InsertOutcome) {
    super("start outcome");
  }
}

interface RoutineItemCopyRow {
  position: number;
  exercise_id: string;
  name: string;
  modality: string;
  is_active: boolean;
  target_sets: number | null;
  target_reps_low: number | null;
  target_reps_high: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  superset_group: number | null;
  notes: string | null;
  section_id: string | null;
}

/**
 * Spec 07.4 §6.5, finished mode (the PR lock is already held): title / notes and Change Time on a
 * finished workout. `{}` / `endedAt: null` change nothing and issue no UPDATE (AC3). A moved start
 * shifts every set time by Δ (from the stored start, so a replay is Δ = 0, AC29), any time change
 * clamps them into the new span (AC25), and only a start change recomputes records (AC26, D3).
 */
async function finishedPatch(
  tx: RawClient,
  userId: string,
  current: WorkoutDbRow,
  patch: UpdateWorkoutFields,
): Promise<UpdateWorkoutResult> {
  const next = retimeOrThrow(
    { startedAt: current.started_at, endedAt: current.ended_at, plannedDurationS: null },
    patch,
    new Date(),
  );
  const detailsSent = "title" in patch || "notes" in patch;
  let row = current;
  if (detailsSent || next.startChanged || next.endChanged) {
    const calendar = await calendarFor(tx, userId, current, next, patch.tzOffsetMinutes);
    const nextTitle = "title" in patch ? (patch.title ?? null) : current.title;
    const nextNotes = "notes" in patch ? (patch.notes ?? null) : current.notes;
    const updated = await tx.$queryRaw<WorkoutDbRow[]>`
      UPDATE "workout"
      SET title = ${nextTitle}, notes = ${nextNotes}, started_at = ${next.startedAt}, ended_at = ${next.endedAt},
          local_date = ${calendar.localDate}::date, tz_offset_minutes = ${calendar.tzOffsetMinutes}, updated_at = now()
      WHERE id = ${current.id}::uuid
      RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
    `;
    row = updated[0]!;
  }
  if (next.startChanged) await shiftSetTimes(tx, current.id, current.started_at, next.startedAt);
  if (next.startChanged || next.endChanged) await clampSetTimes(tx, current.id);
  const recompute = next.startChanged ? await recomputeTimed(tx, userId, current.id, await rootsForWorkout(tx, current.id)) : null;
  const countRows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${current.id}::uuid
  `;
  return {
    workout: toRecord(row),
    exerciseCount: countRows[0]!.n,
    newRecords: [],
    // Title / notes never touch records, but a start change in the same request did recompute them:
    // both log lines then report the same recompute (§9).
    finishedEdit: detailsSent ? (recompute ?? noRecompute(current.id)) : null,
    hadPlannedDuration: false,
    retime: retimeOutcome(patch, true, current.started_at, next, recompute?.recordsRecomputed ?? false),
    oneOff: "none",
  };
}

export function createWorkoutRepository(
  prisma: PrismaClient,
  exerciseRepository: ExerciseRepository,
): WorkoutRepository {
  async function tryInsert(
    client: RawClient,
    id: string,
    actingUserId: string,
    fields: CreateWorkoutFields,
    tzOffsetMinutes: number,
    localDate: string,
  ): Promise<InsertOutcome> {
    try {
      const rows = await client.$queryRaw<WorkoutDbRow[]>`
        INSERT INTO "workout"
          (id, user_id, title, notes, started_at, local_date, tz_offset_minutes,
           client_generated_id, source, created_at, updated_at)
        VALUES
          (${id}::uuid, ${actingUserId}::uuid, ${fields.title ?? null}, ${fields.notes ?? null},
           ${fields.startedAt}, ${localDate}::date, ${tzOffsetMinutes},
           ${fields.clientGeneratedId}::uuid, 'manual', now(), now())
        ON CONFLICT (user_id, client_generated_id) DO NOTHING
        RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                  tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
      `;
      const insertedRow = rows[0];
      return insertedRow
        ? { kind: "inserted", row: insertedRow, copiedCount: 0, plannedSetCount: 0, sectionCount: 0 }
        : { kind: "no-row" };
    } catch (err) {
      if (isRawUniqueViolation(err) && violatedConstraintColumns(err) === "user_id") {
        return { kind: "active-conflict" };
      }
      throw err; // a 23505 on any other constraint is a bug -> surfaces as 500 (D40)
    }
  }

  /**
   * Spec 09 §6.5: the three-outcome insert, then — only when inserted — the
   * copy, all in one transaction. The one-active check (step 1) decides before
   * any routine work; a replay does nothing else (AC18); the routine row is
   * read `FOR SHARE` so a concurrent PUT/DELETE cannot tear the copy (D12).
   * `NotFoundError` / `ExerciseRetiredError` roll the workout back (AC17).
   */
  async function insertFromRoutine(
    id: string,
    actingUserId: string,
    fields: CreateWorkoutFields & { routineId: string },
    tzOffsetMinutes: number,
    localDate: string,
  ): Promise<InsertOutcome> {
    try {
      return await prisma.$transaction(async (tx) => {
        const outcome = await tryInsert(tx, id, actingUserId, fields, tzOffsetMinutes, localDate);
        if (outcome.kind !== "inserted") throw new StartOutcomeSignal(outcome);

        const routineRows = await tx.$queryRaw<{ id: string; name: string; notes: string | null }[]>`
          SELECT id, name, notes FROM "routine"
          WHERE id = ${fields.routineId}::uuid AND user_id = ${actingUserId}::uuid
          FOR SHARE
        `;
        const routine = routineRows[0];
        if (!routine) throw new NotFoundError("routine not found or not owned by the acting user");

        // Spec 09.2 §6.4: sections first, so the item read can join to them. Same transaction, same
        // FOR SHARE (D6: gen_random_uuid — Postgres 16 has no uuidv7()). Fresh ids; position, name,
        // notes verbatim.
        const sectionCount = await tx.$executeRaw`
          INSERT INTO "workout_section" (id, workout_id, position, name, notes, created_at, updated_at)
          SELECT gen_random_uuid(), ${id}::uuid, rs.position, rs.name, rs.notes, now(), now()
          FROM "routine_section" rs
          WHERE rs.routine_id = ${routine.id}::uuid
        `;

        const items = await tx.$queryRaw<RoutineItemCopyRow[]>`
          SELECT ri.position, ri.exercise_id, e.name, e.modality, e.is_active, ri.target_sets,
                 ri.target_reps_low, ri.target_reps_high, ri.target_rpe, ri.rest_seconds, ri.superset_group,
                 ri.notes, ws.id AS section_id
          FROM "routine_item" ri JOIN "exercise" e ON e.id = ri.exercise_id
          LEFT JOIN "routine_section" rs ON rs.id = ri.section_id
          LEFT JOIN "workout_section" ws ON ws.workout_id = ${id}::uuid AND ws.position = rs.position
          WHERE ri.routine_id = ${routine.id}::uuid
          ORDER BY ri.position
        `;
        const retired = items.find((it) => !it.is_active);
        if (retired) {
          // A silently shorter workout is worse than a refusal the lifter can fix (D12).
          throw new ExerciseRetiredError(`routine item ${retired.position} is retired`, {
            fieldErrors: [
              { path: "routineId", message: `item at position ${retired.position} refers to a retired exercise` },
            ],
          });
        }
        let plannedSetCount = 0;
        if (items.length > 0) {
          const values = items.map(
            (it) => Prisma.sql`(
              ${uuidv7()}::uuid, ${id}::uuid, ${it.position}, ${it.exercise_id}::uuid, ${it.name}, ${it.modality}, ${it.notes},
              ${it.target_sets}, ${it.target_reps_low}, ${it.target_reps_high}, ${it.target_rpe},
              ${it.rest_seconds}, ${it.superset_group}, ${it.section_id}::uuid, now(), now())`,
          );
          await tx.$executeRaw`
            INSERT INTO "workout_exercise"
              (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, notes,
               target_sets, target_reps_low, target_reps_high, target_rpe, rest_seconds, superset_group, section_id,
               created_at, updated_at)
            VALUES ${Prisma.join(values)}
          `;
          // Spec 09.1 §6.4: copy each item's rows to the exercise created from it
          // (positions are copied verbatim above, so the join is exact — even for a
          // repeated exercise). Same transaction, same FOR SHARE (D6: gen_random_uuid).
          plannedSetCount = await tx.$executeRaw`
            INSERT INTO "workout_planned_set"
              (id, workout_exercise_id, position, set_type, reps_low, reps_high, weight, weight_unit, created_at, updated_at)
            SELECT gen_random_uuid(), we.id, s.position, s.set_type, s.reps_low, s.reps_high, s.weight, s.weight_unit, now(), now()
            FROM "routine_item" ri
            JOIN "routine_item_set" s  ON s.routine_item_id = ri.id
            JOIN "workout_exercise" we ON we.workout_id = ${id}::uuid AND we.position = ri.position
            WHERE ri.routine_id = ${routine.id}::uuid
          `;
        }
        const updated = await tx.$queryRaw<WorkoutDbRow[]>`
          UPDATE "workout" SET routine_id = ${routine.id}::uuid, routine_name_snapshot = ${routine.name},
                 routine_notes_snapshot = ${routine.notes}
          WHERE id = ${id}::uuid
          RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                    tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
        `;
        return { kind: "inserted", row: updated[0]!, copiedCount: items.length, plannedSetCount, sectionCount } as InsertOutcome;
      });
    } catch (err) {
      if (err instanceof StartOutcomeSignal) return err.outcome;
      throw err; // NotFoundError / ExerciseRetiredError: rolled back, no workout row remains (AC17)
    }
  }

  async function loadExercises(workoutId: string): Promise<WorkoutExerciseRecord[]> {
    const rows = await prisma.$queryRaw<WorkoutExerciseDbRow[]>`
      SELECT id, workout_id, position, exercise_id, exercise_name_snapshot,
             modality_snapshot, notes, created_at, updated_at, target_sets, target_reps_low, target_reps_high, target_rpe, rest_seconds, superset_group, section_id,
             ${WE_PLANNED_SETS} AS planned_sets
      FROM "workout_exercise"
      WHERE workout_id = ${workoutId}::uuid
      ORDER BY position ASC
    `;
    return rows.map(toExerciseRecord);
  }

  /** One statement: the routine's note snapshot, the workout's sections and (Spec 09.3) whether its routine is a
   * one-off. Only the detail path reads these; every other `workout` SELECT is untouched (AC1, D14). */
  async function loadSectionSnapshot(workoutId: string) {
    const rows = await prisma.$queryRaw<
      { routine_notes_snapshot: string | null; sections: WorkoutSectionDbRow[]; routine_is_one_off: boolean }[]
    >`
      SELECT w.routine_notes_snapshot, ${workoutSectionsJson("w.id")} AS sections,
             ${ROUTINE_IS_ONE_OFF("w")} AS routine_is_one_off
      FROM "workout" w WHERE w.id = ${workoutId}::uuid
    `;
    const row = rows[0];
    return {
      routineNotes: row?.routine_notes_snapshot ?? null,
      sections: (row?.sections ?? []).map(toWorkoutSectionRecord),
      routineIsOneOff: row?.routine_is_one_off ?? false,
    };
  }

  async function toDetail(w: WorkoutDbRow): Promise<WorkoutDetailRecord> {
    const exercises = await loadExercises(w.id);
    const sets = await loadSetsForWorkout(prisma, w.id);
    const byExercise = new Map<string, SetEntryRecord[]>();
    for (const s of sets) {
      const list = byExercise.get(s.workoutExerciseId) ?? [];
      list.push(s);
      byExercise.set(s.workoutExerciseId, list);
    }
    const withSets: WorkoutExerciseDetailRecord[] = exercises.map((e) => ({
      ...e,
      sets: byExercise.get(e.id) ?? [],
    }));
    const snapshot = await loadSectionSnapshot(w.id);
    return { ...toRecord(w), exercises: withSets, ...snapshot };
  }

  async function findByClientGeneratedId(
    actingUserId: string,
    clientGeneratedId: string,
  ): Promise<WorkoutDbRow | undefined> {
    const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
      SELECT id, user_id, title, notes, started_at, ended_at, local_date,
             tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
      FROM "workout"
      WHERE user_id = ${actingUserId}::uuid AND client_generated_id = ${clientGeneratedId}::uuid
    `;
    return rows[0];
  }

  return {
    ...createSetEntryMethods(prisma),
    // Spec 07.1 (D9): the history list's read-only queries live in their own module.
    listFinishedWorkouts: (actingUserId, opts) => listFinishedWorkoutsQuery(prisma, actingUserId, opts),
    async createWorkout(
      actingUserId: string,
      fields: CreateWorkoutFields,
      userTimezone: string,
    ): Promise<CreateWorkoutResult> {
      const startedAtIso = fields.startedAt.toISOString();
      const tzOffsetMinutes =
        fields.tzOffsetMinutes ?? offsetMinutesForZone(startedAtIso, userTimezone);
      const localDate = localDateFor(startedAtIso, tzOffsetMinutes);

      // Spec 09 D11: with no `routineId` the path below is byte-for-byte 05.0's.
      const attempt = (): Promise<InsertOutcome> =>
        fields.routineId !== undefined
          ? insertFromRoutine(
              uuidv7(),
              actingUserId,
              { ...fields, routineId: fields.routineId },
              tzOffsetMinutes,
              localDate,
            )
          : tryInsert(prisma, uuidv7(), actingUserId, fields, tzOffsetMinutes, localDate);

      const attempt1 = await attempt();

      if (attempt1.kind === "inserted") {
        return {
          workout: toRecord(attempt1.row),
          created: true,
          copiedCount: attempt1.copiedCount,
          plannedSetCount: attempt1.plannedSetCount,
          sectionCount: attempt1.sectionCount,
        };
      }

      if (attempt1.kind === "active-conflict") {
        const stored = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
        if (stored) return { workout: toRecord(stored), created: false, copiedCount: 0, plannedSetCount: 0, sectionCount: 0 };
        throw new WorkoutInProgressExistsError();
      }

      // attempt1.kind === "no-row": the idempotency key already existed *or*
      // its row was concurrently deleted between the insert and this re-read.
      const stored1 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored1) return { workout: toRecord(stored1), created: false, copiedCount: 0, plannedSetCount: 0, sectionCount: 0 };

      // Delete race: retry the insert exactly once (§6.2 step 3, D40).
      const attempt2 = await attempt();

      if (attempt2.kind === "inserted") {
        return {
          workout: toRecord(attempt2.row),
          created: true,
          copiedCount: attempt2.copiedCount,
          plannedSetCount: attempt2.plannedSetCount,
          sectionCount: attempt2.sectionCount,
        };
      }

      const stored2 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored2) return { workout: toRecord(stored2), created: false, copiedCount: 0, plannedSetCount: 0, sectionCount: 0 };

      if (attempt2.kind === "active-conflict") {
        // The retry raced a *different* in-progress workout: a genuine
        // conflict, not an artifact of the delete race (§6.2 step 3).
        throw new WorkoutInProgressExistsError();
      }

      // attempt2.kind === "no-row" again, and the second re-read is also
      // empty: the loop is bounded at one retry (§6.2, D40).
      throw new InternalError(
        "workout create: idempotency key vanished on both attempts; retry bounded at one",
      );
    },

    async getActiveWorkout(actingUserId: string): Promise<WorkoutDetailRecord> {
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        SELECT id, user_id, title, notes, started_at, ended_at, local_date,
               tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
        FROM "workout"
        WHERE user_id = ${actingUserId}::uuid AND ended_at IS NULL
      `;
      const activeRow = rows[0];
      if (!activeRow) throw new NotFoundError("caller has no in-progress workout");
      return toDetail(activeRow);
    },

    async getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        SELECT id, user_id, title, notes, started_at, ended_at, local_date,
               tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
        FROM "workout"
        WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
      `;
      const foundRow = rows[0];
      if (!foundRow) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      return toDetail(foundRow);
    },

    async updateWorkout(
      actingUserId: string,
      id: string,
      patch: UpdateWorkoutFields,
    ): Promise<UpdateWorkoutResult> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      // Spec 07.4 §6.1: no unlocked preflight here — the live attempt's row lock reveals a finished
      // workout, and a non-finish PATCH then restarts in finished mode (PR lock first).
      return withWriteMode(prisma, actingUserId, null, async (tx, mode) => {
        // Spec 07.0 D9 (amended): a finish attempt takes the per-user PR
        // advisory lock BEFORE the row lock. The recompute's INSERTs take
        // FK KEY SHARE locks on other workouts' rows, so a PR writer that held
        // a row lock while waiting for the PR lock could deadlock with one
        // that holds the PR lock (found by AC18). PR lock → row locks,
        // everywhere. A live non-finish PATCH never takes it (AC13); a finished-mode
        // one already holds it (withWriteMode, 07.4 AC4).
        // Spec 09.3 §6.2: then the one-off routine row (if any), still before the workout row — the
        // routine `DELETE` route holds routine → workout through the FK's SET NULL (D10).
        let oneOffId: string | null = null;
        if (mode === "live" && patch.endedAt != null) {
          await lockUserRecords(tx, actingUserId);
          oneOffId = await lockOneOffForFinish(tx, actingUserId, id);
        }
        // The row lock is the first data-touching statement, ahead of every
        // check (Global Constraints; §6.5's ordering rule) —
        // an explicit row lock, chosen over "issue the UPDATE first" so a
        // later spec's own check (05.1's set-integrity rule) can sit between
        // this lock and the write with no restructuring.
        const rows = await tx.$queryRaw<WorkoutDbRow[]>`
          SELECT id, user_id, title, notes, started_at, ended_at, local_date,
                 tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
          FROM "workout"
          WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
          FOR UPDATE
        `;
        const current = rows[0];
        if (!current) {
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        if (current.ended_at !== null) {
          // Spec 07.4 D17: only a re-finish is refused ("already finished", the client's recovery path).
          if (patch.endedAt != null) throw new WorkoutFinishedError();
          assertStillLive(mode, current.ended_at); // a title/notes edit restarts in finished mode
          return finishedPatch(tx, actingUserId, current, patch);
        }

        // Spec 07.4 §6.4: one pure rule set decides the new start / end / plan (a non-null `endedAt`
        // is the finish; `{}` and `endedAt: null` fall through as no-ops); its 422s roll back.
        const next = retimeOrThrow(
          { startedAt: current.started_at, endedAt: null, plannedDurationS: current.planned_duration_s ?? null },
          patch,
          new Date(),
        );
        const finishing = next.endedAt !== null;
        // AC24 / D8: the calendar fields move only with the start.
        const calendar = await calendarFor(tx, actingUserId, current, next, patch.tzOffsetMinutes);
        const nextTitle = "title" in patch ? (patch.title ?? null) : current.title;
        const nextNotes = "notes" in patch ? (patch.notes ?? null) : current.notes;

        // Spec 05.1 §6.5 (05.0's Extension seam 1): a finish must find every
        // working set complete. Runs after the FOR UPDATE lock above and after
        // the end's own checks, before the UPDATE (05.1 D9). Spec 07.0's
        // PR recompute runs after the UPDATE (07.0 D9), below.
        if (finishing) {
          await assertWorkingSetsComplete(tx, id);
        }

        // A finish clears the plan in the same UPDATE (the live-only CHECK, 07.4 §4).
        const updatedRows = await tx.$queryRaw<WorkoutDbRow[]>`
          UPDATE "workout"
          SET title = ${nextTitle}, notes = ${nextNotes}, started_at = ${next.startedAt}, ended_at = ${next.endedAt},
              local_date = ${calendar.localDate}::date, tz_offset_minutes = ${calendar.tzOffsetMinutes},
              planned_duration_s = ${next.plannedDurationS}, updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                    tz_offset_minutes, client_generated_id, source, created_at, updated_at, routine_name_snapshot, planned_duration_s
        `;
        // §9: `exercise_count` for the `workout_finished` log line comes from
        // this transaction (the lock above already holds the row), not a
        // second round trip after commit.
        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${id}::uuid
        `;
        // Spec 07.0 §6.3: after the UPDATE so the loader's `ended_at IS NOT
        // NULL` sees this workout as finished (a transaction reads its own
        // writes). The PR lock was taken at the top of this transaction.
        let newRecords: PersonalRecordRecord[] = [];
        if (finishing) {
          // 07.4 AC25: no set completes outside its workout (a forgotten workout's sets logged "today").
          await clampSetTimes(tx, id);
          const roots = await rootsForWorkout(tx, id);
          const written = await recomputeRecordsForRoots(tx, actingUserId, roots);
          newRecords = written.filter((r) => r.workoutId === id);
        }
        // Spec 09.3 §6.2 step 4: last, once nothing before it can fail the finish (AC15).
        const oneOff = finishing && oneOffId ? await settleOneOff(tx, actingUserId, oneOffId, patch.keepRoutine === true) : "none";
        return {
          workout: toRecord(updatedRows[0]!),
          exerciseCount: countRows[0]!.n,
          newRecords,
          finishedEdit: null,
          hadPlannedDuration: finishing && (current.planned_duration_s ?? null) !== null,
          retime: retimeOutcome(patch, false, current.started_at, next, false),
          oneOff,
        };
      });
    },
    async deleteWorkout(actingUserId: string, id: string): Promise<DeleteWorkoutResult> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      return prisma.$transaction(async (tx) => {
        // Spec 07.0 D9 (amended): PR advisory lock first, then the row lock —
        // the same order as the finish path (see updateWorkout). Taken even
        // for an in-progress workout: whether it is finished is only known
        // once the row is locked, and a concurrent finish may complete first.
        await lockUserRecords(tx, actingUserId);
        const owned = await tx.$queryRaw<{ id: string; user_id: string; ended_at: Date | null }[]>`
          SELECT id, user_id, ended_at FROM "workout"
          WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
          FOR UPDATE
        `;
        if (!owned[0]) {
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        // §9: both fields are read inside this transaction, before the
        // DELETE runs, so the route's `workout_deleted` log line reflects
        // exactly what was destroyed.
        const wasFinished = owned[0].ended_at !== null;
        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${id}::uuid
        `;
        const exerciseCount = countRows[0]!.n;

        // Spec 07.0 §6.3: only a finished workout can have sourced records.
        // Capture its lineage roots before the DELETE cascades its exercises away.
        const roots = wasFinished ? await rootsForWorkout(tx, id) : [];

        // Hard delete; cascades to workout_exercise (§4, §6.5's DELETE
        // exemption — allowed on an in-progress or finished workout, no
        // state check here).
        const affectedRows = await tx.$executeRaw`DELETE FROM "workout" WHERE id = ${id}::uuid`;
        if (affectedRows === 0) {
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        // The cascade removed the rows this workout sourced; recompute the
        // lineages from what is left (promotes the next best, or no row).
        await recomputeRecordsForRoots(tx, actingUserId, roots);
        return { wasFinished, exerciseCount };
      });
    },
    async addWorkoutExercise(
      actingUserId: string,
      workoutId: string,
      fields: AddWorkoutExerciseFields,
    ): Promise<WithFinishedEdit<WorkoutExerciseRecord>> {
      if (!isWorkoutId(workoutId)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      // Phase 1 (§6.6): cheap early exit on the root client. The
      // authoritative check is the in-transaction FOR SHARE re-check below.
      const wRows = await prisma.$queryRaw<{ id: string; user_id: string; ended_at: Date | null }[]>`
        SELECT id, user_id, ended_at FROM "workout"
        WHERE id = ${workoutId}::uuid AND user_id = ${actingUserId}::uuid
      `;
      const workout = wRows[0];
      if (!workout) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }

      // Phase 2 (§6.6): resolve the exercise on the root client, before the
      // position transaction opens. findVisibleById throws NotFoundError
      // (absent / another user's custom row) or the caller must check
      // isActive itself (03.1's contract returns the row regardless of
      // is_active).
      const exercise = await exerciseRepository.findVisibleById(
        actingUserId,
        fields.exerciseId,
      );
      if (!exercise.isActive) {
        throw new ExerciseRetiredError();
      }

      // Phases 3-4 (§6.7/§6.8): the position transaction — in finished mode behind the PR lock (07.4).
      return withWriteMode(prisma, actingUserId, workout.ended_at ?? null, async (tx, mode) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        // The lock is its own statement, ahead of every read it protects
        // (§6.8, following insertWithCap/D23).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workoutId}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) {
          // Vanished between phase 1 and the lock (§6.7's vanished-row rule).
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        assertStillLive(mode, locked.ended_at);

        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${workoutId}::uuid
        `;
        const n = countRows[0]!.n;

        const position = fields.position ?? computeAppendPosition(n);
        if (fields.position !== undefined) {
          assertAddPositionInRange(fields.position, n);
          await tx.$executeRaw`
            UPDATE "workout_exercise" SET position = position + 1
            WHERE workout_id = ${workoutId}::uuid AND position >= ${position}
          `;
        }

        const id = uuidv7();
        const insertedRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
          INSERT INTO "workout_exercise"
            (id, workout_id, position, exercise_id, exercise_name_snapshot,
             modality_snapshot, notes, created_at, updated_at)
          VALUES
            (${id}::uuid, ${workoutId}::uuid, ${position}, ${exercise.id}::uuid,
             ${exercise.name}, ${exercise.modality}, ${fields.notes ?? null}, now(), now())
          RETURNING id, workout_id, position, exercise_id, exercise_name_snapshot,
                    modality_snapshot, notes, created_at, updated_at, target_sets, target_reps_low, target_reps_high, target_rpe, rest_seconds, superset_group, section_id,
                    '[]'::json AS planned_sets
        `;
        const added = toExerciseRecord(insertedRows[0]!);
        // 07.4 §6.2: an added card has no sets yet, so it can affect no record.
        return { ...added, finishedEdit: mode === "finished" ? noRecompute(workoutId) : null };
      });
    },
    async updateWorkoutExercise(
      actingUserId: string,
      id: string,
      patch: UpdateWorkoutExerciseFields,
    ): Promise<WithFinishedEdit<WorkoutExerciseRecord> & { moved: boolean }> {
      if (!isWorkoutExerciseId(id)) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      // Ownership is resolved through the workout_exercise -> workout join --
      // a workout_exercise row carries no user_id of its own (§6.7, §5's
      // 404-not-403 rule). This also doubles as §6.6-style phase 1: a cheap
      // early exit on the root client, ahead of any lock.
      const rows = await prisma.$queryRaw<
        {
          id: string;
          workout_id: string;
          position: number;
          notes: string | null;
          user_id: string;
          ended_at: Date | null;
        }[]
      >`
        SELECT we.id, we.workout_id, we.position, we.notes, w.user_id, w.ended_at
        FROM "workout_exercise" we
        JOIN "workout" w ON w.id = we.workout_id
        WHERE we.id = ${id}::uuid AND w.user_id = ${actingUserId}::uuid
      `;
      const current = rows[0];
      if (!current) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }

      // Every patch shape (position change, notes-only, or {}) goes through
      // the same lock/deferred-constraint transaction (§6.7): a notes-only
      // edit that skipped this path could commit after a concurrent
      // finishWorkout, without ever raising WorkoutFinishedError.
      const workoutId = current.workout_id;
      const requestedPosition = patch.position;
      return withWriteMode(prisma, actingUserId, current.ended_at ?? null, async (tx, mode) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        // The lock is its own statement, ahead of every read it protects
        // (§6.8, following insertWithCap/D23).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workoutId}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) {
          // Vanished between phase 1 and the lock (§6.7's vanished-row rule).
          throw new NotFoundError("workout exercise not found or not owned by the acting user");
        }
        assertStillLive(mode, locked.ended_at);

        const targetRows = await tx.$queryRaw<
          { id: string; position: number; notes: string | null; superset_group: number | null }[]
        >`
          SELECT id, position, notes, superset_group FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
        `;
        const target = targetRows[0];
        if (!target) {
          throw new NotFoundError("workout exercise not found or not owned by the acting user");
        }

        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${workoutId}::uuid
        `;
        const n = countRows[0]!.n;

        let nextPosition = target.position;
        if (requestedPosition !== undefined && requestedPosition !== target.position) {
          // Reorder requires 0 <= position <= n-1 (narrower than add's
          // 0 <= position <= n, since a reorder targets an existing slot).
          // Only checked when actually moving -- a same-position "no-op"
          // request is always in range since it came from a real row.
          assertReorderPositionInRange(requestedPosition, n);
          nextPosition = requestedPosition;
          if (nextPosition > target.position) {
            // Moving forward: the rows strictly between the old and new
            // position shift back by one to close the gap the move opens.
            await tx.$executeRaw`
              UPDATE "workout_exercise" SET position = position - 1
              WHERE workout_id = ${workoutId}::uuid
                AND position > ${target.position} AND position <= ${nextPosition}
                AND id != ${id}::uuid
            `;
          } else {
            // Moving backward: the rows strictly between the new and old
            // position shift forward by one to make room.
            await tx.$executeRaw`
              UPDATE "workout_exercise" SET position = position + 1
              WHERE workout_id = ${workoutId}::uuid
                AND position >= ${nextPosition} AND position < ${target.position}
                AND id != ${id}::uuid
            `;
          }
        }
        // requestedPosition === target.position: a 200 no-op (§6.7) -- no
        // other row is touched.

        const nextNotes = "notes" in patch ? (patch.notes ?? null) : target.notes;
        // Spec 09 D10: key present with `null` clears; absent leaves the group.
        // No density, adjacency or size rule on a workout.
        const nextGroup = "supersetGroup" in patch ? (patch.supersetGroup ?? null) : target.superset_group;
        const updatedRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
          UPDATE "workout_exercise"
          SET position = ${nextPosition}, notes = ${nextNotes}, superset_group = ${nextGroup}, updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, workout_id, position, exercise_id, exercise_name_snapshot,
                    modality_snapshot, notes, created_at, updated_at, target_sets, target_reps_low, target_reps_high, target_rpe, rest_seconds, superset_group, section_id,
                    ${WE_PLANNED_SETS} AS planned_sets
        `;
        const exercise = toExerciseRecord(updatedRows[0]!);
        const moved = nextPosition !== target.position;
        const changed = moved || nextNotes !== target.notes || nextGroup !== target.superset_group;
        // A no-op PATCH in finished mode reports no edit (same as the workout PATCH's `{}`).
        if (mode === "live" || !changed) return { ...exercise, finishedEdit: null, moved };
        // 07.4 §6.2 / AC7: position is a records tie-break only between cards of one lineage, and a
        // move changes only the moved card's order against the others.
        const root = moved ? await repeatedRootOfWorkoutExercise(tx, id) : null;
        return { ...exercise, finishedEdit: await recomputeTimed(tx, actingUserId, workoutId, root ? [root] : []), moved };
      });
    },
    async deleteWorkoutExercise(actingUserId: string, id: string): Promise<{ finishedEdit: FinishedEdit | null }> {
      if (!isWorkoutExerciseId(id)) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      // Ownership is resolved through the workout_exercise -> workout join --
      // a workout_exercise row carries no user_id of its own (§6.7, §5's
      // 404-not-403 rule). This also doubles as §6.6-style phase 1: a cheap
      // early exit on the root client, ahead of any lock.
      const rows = await prisma.$queryRaw<
        { id: string; workout_id: string; user_id: string; ended_at: Date | null }[]
      >`
        SELECT we.id, we.workout_id, w.user_id, w.ended_at
        FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
        WHERE we.id = ${id}::uuid AND w.user_id = ${actingUserId}::uuid
      `;
      const current = rows[0];
      if (!current) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }

      return withWriteMode(prisma, actingUserId, current.ended_at ?? null, async (tx, mode) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        // The lock is its own statement, ahead of every read it protects
        // (§6.8, following insertWithCap/D23).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.workout_id}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${current.workout_id}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) {
          // Vanished between phase 1 and the lock (§6.7's vanished-row rule).
          throw new NotFoundError("workout exercise not found or not owned by the acting user");
        }
        assertStillLive(mode, locked.ended_at);

        const targetRows = await tx.$queryRaw<{ position: number }[]>`
          SELECT position FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
        `;
        const target = targetRows[0];
        if (!target) {
          throw new NotFoundError("workout exercise not found or not owned by the acting user");
        }

        // 07.4 §6.2 / §6.3: in finished mode, read the card's sets and its root BEFORE the cascade
        // removes them, and refuse to empty the workout.
        let roots: string[] = [];
        if (mode === "finished") {
          const own = await tx.$queryRaw<{ n: number; has_working: boolean | null }[]>`
            SELECT count(*)::int AS n, bool_or(set_type = 'working') AS has_working
            FROM "set_entry" WHERE workout_exercise_id = ${id}::uuid
          `;
          await assertWouldNotEmpty(tx, current.workout_id, own[0]?.n ?? 0);
          if (own[0]?.has_working) roots = [await rootOfWorkoutExercise(tx, id)];
        }

        await tx.$executeRaw`DELETE FROM "workout_exercise" WHERE id = ${id}::uuid`;
        await tx.$executeRaw`
          UPDATE "workout_exercise" SET position = position - 1
          WHERE workout_id = ${current.workout_id}::uuid AND position > ${target.position}
        `;
        if (mode === "live") return { finishedEdit: null };
        return { finishedEdit: await recomputeTimed(tx, actingUserId, current.workout_id, roots) };
      });
    },
  };
}

// Spec 11: the account export reuses these row mappers (no logic change).
export { toRecord as toWorkoutRecord, toExerciseRecord as toWorkoutExerciseRecord, WE_PLANNED_SETS };
