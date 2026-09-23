// apps/api/src/repositories/workout.prisma.ts
import type { PrismaClient } from "@prisma/client";
import { localDateFor, offsetMinutesForZone } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { InternalError, WorkoutInProgressExistsError } from "../errors/app-error.js";
import type {
  CreateWorkoutFields,
  CreateWorkoutResult,
  WorkoutRecord,
  WorkoutRepository,
} from "./workout.js";

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

/** The constraint name is parsed out of the driver's message
 * (`duplicate key value violates unique constraint "…"`) — Postgres does not
 * hand back a structured constraint name on this error path. */
function violatedConstraintName(err: RawPrismaError): string | null {
  const match = /unique constraint "([^"]+)"/.exec(err.meta?.message ?? "");
  return match?.[1] ?? null;
}

type InsertOutcome =
  | { kind: "inserted"; row: WorkoutDbRow }
  | { kind: "no-row" }
  | { kind: "active-conflict" };

export function createWorkoutRepository(prisma: PrismaClient): WorkoutRepository {
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
      if (isRawUniqueViolation(err) && violatedConstraintName(err) === "workout_user_active_key") {
        return { kind: "active-conflict" };
      }
      throw err; // a 23505 on any other constraint is a bug -> surfaces as 500 (D40)
    }
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

    // Tasks 11-16 implement these; each replaces its own placeholder in order.
    getActiveWorkout: () => {
      throw new Error("not implemented until Task 11");
    },
    getWorkoutById: () => {
      throw new Error("not implemented until Task 11");
    },
    updateWorkout: () => {
      throw new Error("not implemented until Task 12");
    },
    deleteWorkout: () => {
      throw new Error("not implemented until Task 13");
    },
    addWorkoutExercise: () => {
      throw new Error("not implemented until Task 14");
    },
    updateWorkoutExercise: () => {
      throw new Error("not implemented until Task 15");
    },
    deleteWorkoutExercise: () => {
      throw new Error("not implemented until Task 16");
    },
  };
}
