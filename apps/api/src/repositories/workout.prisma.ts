// apps/api/src/repositories/workout.prisma.ts
import type { PrismaClient } from "@prisma/client";
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
import type {
  AddWorkoutExerciseFields,
  CreateWorkoutFields,
  CreateWorkoutResult,
  UpdateWorkoutExerciseFields,
  UpdateWorkoutFields,
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
} from "./workout.js";
import {
  assertAddPositionInRange,
  assertEndedAtInBounds,
  assertEndedAtNotBeforeStartedAt,
  assertReorderPositionInRange,
  computeAppendPosition,
} from "./workout-writes.js";

/**
 * Prisma-backed WorkoutRepository (Spec 05.0 §6, "Wiring points"). Raw SQL
 * throughout, mirroring `exercise.prisma.ts`: the partial unique index, the
 * deferred constraint and the advisory-lock idiom are not expressible via
 * Prisma's query builder.
 */

interface WorkoutDbRow {
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
  };
}

interface WorkoutExerciseDbRow {
  id: string;
  workout_id: string;
  position: number;
  exercise_id: string;
  exercise_name_snapshot: string;
  modality_snapshot: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

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
  };
}

interface RawPrismaError extends Error {
  code?: string;
  meta?: { code?: string; message?: string };
}

/** True for a raw-query unique-violation surfaced through `$queryRaw`
 * (`P2010` + driver SQLSTATE `23505` in `meta` — distinct from the typed
 * client's `P2002` + `meta.target`; Spec 05.0 D40 pins this shape). */
function isRawUniqueViolation(err: unknown): err is RawPrismaError {
  return (
    err instanceof Error &&
    (err as RawPrismaError).code === "P2010" &&
    (err as RawPrismaError).meta?.code === "23505"
  );
}

/**
 * Against a real driver, `meta.message` on this error path is only the
 * DETAIL line (`Key (col[, col...])=(val[, val...]) already exists.`) — the
 * primary message that names the constraint (`duplicate key value violates
 * unique constraint "…"`) is not surfaced through `$queryRaw`'s error
 * mapping, so the constraint can't be identified by name here. It's
 * identified by column list instead: the INSERT's `ON CONFLICT (user_id,
 * client_generated_id) DO NOTHING` already suppresses `workout_user_client_id_key`
 * violations without raising, so the only unique index left that can throw
 * from this statement is the single-column partial index
 * `workout_user_active_key` (on `user_id`, `WHERE ended_at IS NULL`) — its
 * violation's DETAIL always lists exactly `user_id`.
 */
function violatedConstraintColumns(err: RawPrismaError): string | null {
  const match = /^Key \(([^)]+)\)=/.exec(err.meta?.message ?? "");
  return match?.[1]?.trim() ?? null;
}

type InsertOutcome =
  | { kind: "inserted"; row: WorkoutDbRow }
  | { kind: "no-row" }
  | { kind: "active-conflict" };

export function createWorkoutRepository(
  prisma: PrismaClient,
  exerciseRepository: ExerciseRepository,
): WorkoutRepository {
  async function tryInsert(
    id: string,
    actingUserId: string,
    fields: CreateWorkoutFields,
    tzOffsetMinutes: number,
    localDate: string,
  ): Promise<InsertOutcome> {
    try {
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        INSERT INTO "workout"
          (id, user_id, title, notes, started_at, local_date, tz_offset_minutes,
           client_generated_id, source, created_at, updated_at)
        VALUES
          (${id}::uuid, ${actingUserId}::uuid, ${fields.title ?? null}, ${fields.notes ?? null},
           ${fields.startedAt}, ${localDate}::date, ${tzOffsetMinutes},
           ${fields.clientGeneratedId}::uuid, 'manual', now(), now())
        ON CONFLICT (user_id, client_generated_id) DO NOTHING
        RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                  tz_offset_minutes, client_generated_id, source, created_at, updated_at
      `;
      const insertedRow = rows[0];
      return insertedRow ? { kind: "inserted", row: insertedRow } : { kind: "no-row" };
    } catch (err) {
      if (isRawUniqueViolation(err) && violatedConstraintColumns(err) === "user_id") {
        return { kind: "active-conflict" };
      }
      throw err; // a 23505 on any other constraint is a bug -> surfaces as 500 (D40)
    }
  }

  async function loadExercises(workoutId: string): Promise<WorkoutExerciseRecord[]> {
    const rows = await prisma.$queryRaw<WorkoutExerciseDbRow[]>`
      SELECT id, workout_id, position, exercise_id, exercise_name_snapshot,
             modality_snapshot, notes, created_at, updated_at
      FROM "workout_exercise"
      WHERE workout_id = ${workoutId}::uuid
      ORDER BY position ASC
    `;
    return rows.map(toExerciseRecord);
  }

  async function toDetail(w: WorkoutDbRow): Promise<WorkoutDetailRecord> {
    return { ...toRecord(w), exercises: await loadExercises(w.id) };
  }

  async function findByClientGeneratedId(
    actingUserId: string,
    clientGeneratedId: string,
  ): Promise<WorkoutDbRow | undefined> {
    const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
      SELECT id, user_id, title, notes, started_at, ended_at, local_date,
             tz_offset_minutes, client_generated_id, source, created_at, updated_at
      FROM "workout"
      WHERE user_id = ${actingUserId}::uuid AND client_generated_id = ${clientGeneratedId}::uuid
    `;
    return rows[0];
  }

  return {
    async createWorkout(
      actingUserId: string,
      fields: CreateWorkoutFields,
      userTimezone: string,
    ): Promise<CreateWorkoutResult> {
      const startedAtIso = fields.startedAt.toISOString();
      const tzOffsetMinutes =
        fields.tzOffsetMinutes ?? offsetMinutesForZone(startedAtIso, userTimezone);
      const localDate = localDateFor(startedAtIso, tzOffsetMinutes);

      const attempt1 = await tryInsert(
        uuidv7(),
        actingUserId,
        fields,
        tzOffsetMinutes,
        localDate,
      );

      if (attempt1.kind === "inserted") {
        return { workout: toRecord(attempt1.row), created: true };
      }

      if (attempt1.kind === "active-conflict") {
        const stored = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
        if (stored) return { workout: toRecord(stored), created: false };
        throw new WorkoutInProgressExistsError();
      }

      // attempt1.kind === "no-row": the idempotency key already existed *or*
      // its row was concurrently deleted between the insert and this re-read.
      const stored1 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored1) return { workout: toRecord(stored1), created: false };

      // Delete race: retry the insert exactly once (§6.2 step 3, D40).
      const attempt2 = await tryInsert(
        uuidv7(),
        actingUserId,
        fields,
        tzOffsetMinutes,
        localDate,
      );

      if (attempt2.kind === "inserted") {
        return { workout: toRecord(attempt2.row), created: true };
      }

      const stored2 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored2) return { workout: toRecord(stored2), created: false };

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
               tz_offset_minutes, client_generated_id, source, created_at, updated_at
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
               tz_offset_minutes, client_generated_id, source, created_at, updated_at
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
    ): Promise<WorkoutRecord> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      return prisma.$transaction(async (tx) => {
        // The lock is this transaction's first data-touching statement,
        // ahead of every check (Global Constraints; §6.5's ordering rule) —
        // an explicit row lock, chosen over "issue the UPDATE first" so a
        // later spec's own check (05.1's set-integrity rule) can sit between
        // this lock and the write with no restructuring.
        const rows = await tx.$queryRaw<WorkoutDbRow[]>`
          SELECT id, user_id, title, notes, started_at, ended_at, local_date,
                 tz_offset_minutes, client_generated_id, source, created_at, updated_at
          FROM "workout"
          WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
          FOR UPDATE
        `;
        const current = rows[0];
        if (!current) {
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        // The target's state is checked before any handler body rule — a
        // finished workout rejects every schema-valid PATCH, {} included
        // (§6.5, AC8).
        if (current.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

        const now = new Date();
        let nextEndedAt: Date | null = current.ended_at;
        if ("endedAt" in patch && patch.endedAt !== undefined) {
          if (patch.endedAt === null) {
            // In-progress workout, ended_at already NULL: a no-op (§6.5).
            nextEndedAt = null;
          } else {
            const endedAt = new Date(patch.endedAt);
            assertEndedAtNotBeforeStartedAt(current.started_at, endedAt);
            assertEndedAtInBounds(endedAt, now);
            nextEndedAt = endedAt;
          }
        }
        const nextTitle = "title" in patch ? (patch.title ?? null) : current.title;
        const nextNotes = "notes" in patch ? (patch.notes ?? null) : current.notes;

        const updatedRows = await tx.$queryRaw<WorkoutDbRow[]>`
          UPDATE "workout"
          SET title = ${nextTitle}, notes = ${nextNotes}, ended_at = ${nextEndedAt},
              updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                    tz_offset_minutes, client_generated_id, source, created_at, updated_at
        `;
        return toRecord(updatedRows[0]!);
      });
    },
    async deleteWorkout(actingUserId: string, id: string): Promise<void> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      const owned = await prisma.$queryRaw<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM "workout"
        WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
      `;
      if (!owned[0]) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      // Hard delete; cascades to workout_exercise (§4, §6.5's DELETE exemption
      // — allowed on an in-progress or finished workout, no state check here).
      const affectedRows = await prisma.$executeRaw`DELETE FROM "workout" WHERE id = ${id}::uuid`;
      if (affectedRows === 0) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
    },
    async addWorkoutExercise(
      actingUserId: string,
      workoutId: string,
      fields: AddWorkoutExerciseFields,
    ): Promise<WorkoutExerciseRecord> {
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
      if (workout.ended_at !== null) {
        throw new WorkoutFinishedError();
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

      // Phases 3-4 (§6.7/§6.8): the position transaction.
      return prisma.$transaction(async (tx) => {
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
        if (locked.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

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
                    modality_snapshot, notes, created_at, updated_at
        `;
        return toExerciseRecord(insertedRows[0]!);
      });
    },
    async updateWorkoutExercise(
      actingUserId: string,
      id: string,
      patch: UpdateWorkoutExerciseFields,
    ): Promise<WorkoutExerciseRecord> {
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
      if (current.ended_at !== null) {
        throw new WorkoutFinishedError();
      }

      // Every patch shape (position change, notes-only, or {}) goes through
      // the same lock/deferred-constraint transaction (§6.7): a notes-only
      // edit that skipped this path could commit after a concurrent
      // finishWorkout, without ever raising WorkoutFinishedError.
      const workoutId = current.workout_id;
      const requestedPosition = patch.position;
      return prisma.$transaction(async (tx) => {
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
        if (locked.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

        const targetRows = await tx.$queryRaw<
          { id: string; position: number; notes: string | null }[]
        >`
          SELECT id, position, notes FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
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
        const updatedRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
          UPDATE "workout_exercise"
          SET position = ${nextPosition}, notes = ${nextNotes}, updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, workout_id, position, exercise_id, exercise_name_snapshot,
                    modality_snapshot, notes, created_at, updated_at
        `;
        return toExerciseRecord(updatedRows[0]!);
      });
    },
    async deleteWorkoutExercise(actingUserId: string, id: string): Promise<void> {
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
      if (current.ended_at !== null) {
        throw new WorkoutFinishedError();
      }

      await prisma.$transaction(async (tx) => {
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
        if (locked.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

        const targetRows = await tx.$queryRaw<{ position: number }[]>`
          SELECT position FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
        `;
        const target = targetRows[0];
        if (!target) {
          throw new NotFoundError("workout exercise not found or not owned by the acting user");
        }

        await tx.$executeRaw`DELETE FROM "workout_exercise" WHERE id = ${id}::uuid`;
        await tx.$executeRaw`
          UPDATE "workout_exercise" SET position = position - 1
          WHERE workout_id = ${current.workout_id}::uuid AND position > ${target.position}
        `;
      });
    },
  };
}
