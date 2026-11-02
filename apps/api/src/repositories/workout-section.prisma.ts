import { Prisma, type PrismaClient } from "@prisma/client";
import { isWorkoutId, isWorkoutSectionId, ROUTINE_SECTIONS_MAX, timerFitsRecorded, type SectionTimer } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { NotFoundError, SectionResultExistsError, WorkoutSectionLimitError } from "../errors/app-error.js";
import { roundTimesJson, timerFromColumns, timerToColumns } from "./section-timer-columns.js";
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
 * The cheap ownership preflight an add runs on the root client before its transaction (Spec 05.0 §6.6 phase 1 for an
 * exercise, Spec 09.4 §6.1 for a section): the caller's workout's `ended_at`, or `notFound()`. The authoritative check is `lockWorkoutStructure`'s
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

/** Spec 09.5 — the RETURNING / SELECT list carries the timer, result and round times like the reads (Review Focus 2). */
const SECTION_COLUMNS = Prisma.raw(
  `id, position, name, notes, added_in_workout, timer_format, timer_round_s, timer_rounds, timer_cap_s,
   result_rounds, result_reps, result_finish_s, result_capped, ${roundTimesJson('"workout_section".id').sql} AS round_times`,
);

/** Two timers as `timerFromColumns` builds them (fixed key order), so a string compare is a deep compare. */
const sameTimer = (a: SectionTimer | null, b: SectionTimer | null): boolean => JSON.stringify(a) === JSON.stringify(b);

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
        // Spec 09.5 AC12 — the timer plan through the one column mapping; nothing is recorded yet.
        const t = timerToColumns(fields.timer);
        const inserted = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout,
                                         timer_format, timer_round_s, timer_rounds, timer_cap_s)
          VALUES (${uuidv7()}::uuid, ${workoutId}::uuid, ${n}, ${fields.name}, ${fields.notes}, true,
                  ${t.timer_format}::text, ${t.timer_round_s}::int, ${t.timer_rounds}::smallint, ${t.timer_cap_s}::int)
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
        const stored = toWorkoutSectionRecord(current);
        // Spec 09.5 AC13 — normalize first, so `{ format: "time_cap" }` equals a stored For Time (Review Focus 4).
        const timer = patch.timer === undefined ? stored.timer : timerFromColumns(timerToColumns(patch.timer));
        const timerChanged = !sameTimer(timer, stored.timer);
        const recorded = stored.roundTimes.length > 0 || stored.result !== null;
        let resultCleared = false;
        if (timerChanged && recorded) {
          const keeps =
            timer !== null &&
            stored.timer !== null &&
            timer.format === stored.timer.format &&
            timerFitsRecorded(timer, stored.roundTimes, stored.result).length === 0;
          // Before any write, so a refused timer change takes the rename with it (Review Focus 3).
          if (!keeps && patch.discardResult !== true) throw new SectionResultExistsError();
          resultCleared = !keeps;
        }
        if (!nameChanged && !notesChanged && !timerChanged) {
          // An equal body writes nothing; `discardResult` is ignored (Review Focus 2).
          return { ...stored, workoutId: pre.workout_id, nameChanged, notesChanged, timerChanged, resultCleared, finishedEdit: null };
        }
        if (resultCleared) {
          await tx.$executeRaw`DELETE FROM "workout_section_round" WHERE workout_section_id = ${sectionId}::uuid`;
        }
        const t = timerToColumns(timer);
        // One UPDATE: the result is cleared in the same statement that changes the timer, so the shape CHECK never sees a mix.
        const updated = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          UPDATE "workout_section" SET name = ${name}, notes = ${notes},
                 timer_format = ${t.timer_format}::text, timer_round_s = ${t.timer_round_s}::int,
                 timer_rounds = ${t.timer_rounds}::smallint, timer_cap_s = ${t.timer_cap_s}::int,
                 result_rounds = CASE WHEN ${resultCleared}::boolean THEN NULL ELSE result_rounds END,
                 result_reps = CASE WHEN ${resultCleared}::boolean THEN NULL ELSE result_reps END,
                 result_finish_s = CASE WHEN ${resultCleared}::boolean THEN NULL ELSE result_finish_s END,
                 result_capped = CASE WHEN ${resultCleared}::boolean THEN false ELSE result_capped END,
                 updated_at = now()
          WHERE id = ${sectionId}::uuid
          RETURNING ${SECTION_COLUMNS}
        `;
        return {
          ...toWorkoutSectionRecord(updated[0]!),
          workoutId: pre.workout_id,
          nameChanged,
          notesChanged,
          timerChanged,
          resultCleared,
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
