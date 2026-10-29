import { Prisma, type PrismaClient } from "@prisma/client";
import { isWorkoutId, isWorkoutSectionId, ROUTINE_SECTIONS_MAX } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutSectionLimitError } from "../errors/app-error.js";
import type { RawClient } from "./set-entry.prisma.js";
import type { WorkoutRepository } from "./workout.js";
import { toWorkoutSectionRecord, type WorkoutSectionDbRow } from "./workout.prisma.js";
import { assertStillLive, noRecompute, withWriteMode, type WriteMode } from "./write-mode.js";

/**
 * Spec 09.4 §6.1 — the per-workout structure lock every exercise add / move / remove already takes
 * (Spec 05.0 §6.8), now also serializing section writes: the deferred exercise-position constraint,
 * the advisory lock, the workout row `FOR SHARE`, then the live/finished re-check. A workout that
 * vanished after the preflight throws `notFound()`.
 */
export async function lockWorkoutStructure(
  tx: RawClient,
  mode: WriteMode,
  workoutId: string,
  notFound: () => Error,
): Promise<void> {
  await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workoutId}))`;
  const rows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
    SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
  `;
  const locked = rows[0];
  if (!locked) throw notFound();
  assertStillLive(mode, locked.ended_at);
}

/**
 * The cheap ownership preflight a structure write runs on the root client before its transaction (Spec 05.0 §6.6
 * phase 1): the caller's workout's `ended_at`, or `notFound()`. The authoritative check is `lockWorkoutStructure`'s
 * `FOR SHARE` re-read. One copy for the section and exercise adds (minor 57).
 */
export async function workoutPreflight(
  db: RawClient,
  userId: string,
  workoutId: string,
  notFound: () => Error,
): Promise<{ ended_at: Date | null }> {
  const rows = await db.$queryRaw<{ ended_at: Date | null }[]>`
    SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid AND user_id = ${userId}::uuid
  `;
  const workout = rows[0];
  if (!workout) throw notFound();
  return workout;
}

/** Spec 09.4 §6.2 — each exercise's rank (its section's position, -1 = loose), in position order, excluding `excludeId`. */
export async function exerciseRanks(tx: RawClient, workoutId: string, excludeId: string | null): Promise<number[]> {
  const rows = await tx.$queryRaw<{ rank: number }[]>`
    SELECT COALESCE(s.position, -1)::int AS rank
    FROM "workout_exercise" we LEFT JOIN "workout_section" s ON s.id = we.section_id
    WHERE we.workout_id = ${workoutId}::uuid AND (${excludeId}::uuid IS NULL OR we.id <> ${excludeId}::uuid)
    ORDER BY we.position
  `;
  return rows.map((r) => r.rank);
}

const workoutNotFound = () => new NotFoundError("workout not found or not owned by the acting user");
const sectionNotFound = () => new NotFoundError("workout section not found or not owned by the acting user");

const SECTION_COLUMNS = Prisma.raw("id, position, name, notes, added_in_workout");

type SectionMethods = Pick<WorkoutRepository, "addWorkoutSection" | "updateWorkoutSection" | "removeWorkoutSection">;

/** Spec 09.4 §6.4 — create / update / remove a workout's own section, live or finished (07.4 `withWriteMode`). */
export function workoutSectionMethods(prisma: PrismaClient): SectionMethods {
  /** Unlocked preflight: the section's workout, resolved through `user_id = $acting` (404, never 403). */
  async function sectionPreflight(actingUserId: string, sectionId: string) {
    if (!isWorkoutSectionId(sectionId)) throw sectionNotFound();
    const rows = await prisma.$queryRaw<{ workout_id: string; ended_at: Date | null }[]>`
      SELECT s.workout_id::text AS workout_id, w.ended_at
      FROM "workout_section" s JOIN "workout" w ON w.id = s.workout_id
      WHERE s.id = ${sectionId}::uuid AND w.user_id = ${actingUserId}::uuid
    `;
    const row = rows[0];
    if (!row) throw sectionNotFound();
    return row;
  }

  return {
    async addWorkoutSection(actingUserId, workoutId, fields) {
      if (!isWorkoutId(workoutId)) throw workoutNotFound();
      const workout = await workoutPreflight(prisma, actingUserId, workoutId, workoutNotFound);
      return withWriteMode(prisma, actingUserId, workout.ended_at, async (tx, mode) => {
        await lockWorkoutStructure(tx, mode, workoutId, workoutNotFound);
        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_section" WHERE workout_id = ${workoutId}::uuid
        `;
        const n = countRows[0]!.n;
        if (n >= ROUTINE_SECTIONS_MAX) throw new WorkoutSectionLimitError();
        const inserted = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout)
          VALUES (${uuidv7()}::uuid, ${workoutId}::uuid, ${n}, ${fields.name}, ${fields.notes}, true)
          RETURNING ${SECTION_COLUMNS}
        `;
        return {
          ...toWorkoutSectionRecord(inserted[0]!),
          workoutId,
          sectionCount: n + 1,
          finishedEdit: mode === "finished" ? noRecompute(workoutId) : null,
        };
      });
    },

    async updateWorkoutSection(actingUserId, sectionId, patch) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        await lockWorkoutStructure(tx, mode, pre.workout_id, sectionNotFound);
        const rows = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          SELECT ${SECTION_COLUMNS} FROM "workout_section" WHERE id = ${sectionId}::uuid FOR UPDATE
        `;
        const current = rows[0];
        if (!current) throw sectionNotFound();
        const name = patch.name ?? current.name;
        const notes = "notes" in patch && patch.notes !== undefined ? patch.notes : current.notes;
        const nameChanged = name !== current.name;
        const notesChanged = notes !== current.notes;
        if (!nameChanged && !notesChanged) {
          return { ...toWorkoutSectionRecord(current), workoutId: pre.workout_id, nameChanged, notesChanged, finishedEdit: null };
        }
        const updated = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          UPDATE "workout_section" SET name = ${name}, notes = ${notes}, updated_at = now()
          WHERE id = ${sectionId}::uuid
          RETURNING ${SECTION_COLUMNS}
        `;
        return {
          ...toWorkoutSectionRecord(updated[0]!),
          workoutId: pre.workout_id,
          nameChanged,
          notesChanged,
          finishedEdit: mode === "finished" ? noRecompute(pre.workout_id) : null,
        };
      });
    },

    async removeWorkoutSection(actingUserId, sectionId) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        await lockWorkoutStructure(tx, mode, pre.workout_id, sectionNotFound);
        const rows = await tx.$queryRaw<{ position: number }[]>`
          SELECT position FROM "workout_section" WHERE id = ${sectionId}::uuid FOR UPDATE
        `;
        const removed = rows[0];
        if (!removed) throw sectionNotFound();
        const counted = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE section_id = ${sectionId}::uuid
        `;
        // The FK's ON DELETE SET NULL loosens the section's exercises; their positions are untouched (D13).
        await tx.$executeRaw`DELETE FROM "workout_section" WHERE id = ${sectionId}::uuid`;
        // The position index is not deferrable, so close the gap one row at a time, ascending (D5).
        const later = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM "workout_section"
          WHERE workout_id = ${pre.workout_id}::uuid AND position > ${removed.position}
          ORDER BY position
        `;
        for (const { id } of later) {
          await tx.$executeRaw`UPDATE "workout_section" SET position = position - 1, updated_at = now() WHERE id = ${id}::uuid`;
        }
        return {
          workoutId: pre.workout_id,
          exerciseCount: counted[0]!.n,
          finishedEdit: mode === "finished" ? noRecompute(pre.workout_id) : null,
        };
      });
    },
  };
}
