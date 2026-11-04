import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isWorkoutId,
  isWorkoutSectionId,
  ROUTINE_SECTIONS_MAX,
  resultIssues,
  roundTimeIssues,
  sortedRoundTimes,
  timerChangeKeepsRecorded,
  timersEqual,
  type TimerIssue,
} from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  NotFoundError,
  SectionResultExistsError,
  SectionTimerMismatchError,
  ValidationError,
  WorkoutSectionLimitError,
} from "../errors/app-error.js";
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

type SectionMethods = Pick<
  WorkoutRepository,
  | "addWorkoutSection"
  | "updateWorkoutSection"
  | "removeWorkoutSection"
  | "setSectionRoundTime"
  | "clearSectionRoundTime"
  | "setSectionResult"
  | "clearSectionResult"
>;

/** A handler-raised 422 from the `@sin/core` rules: `{ path, message }` only — the `code` never reaches the wire (AC3). */
const timerValidationError = (issues: readonly TimerIssue[]) => new ValidationError(issues.map(({ path, message }) => ({ path, message })));

/**
 * Spec 09.5 §6.1 / D19 — the envelope of the round-time and result writes. They change no position or membership,
 * so they skip the structure advisory lock and `SET CONSTRAINTS`: [finished: the PR lock, from `withWriteMode`]
 * → workout `FOR SHARE` (`assertStillLive`) → section `FOR UPDATE`. The section row lock serializes round, result
 * and timer writes on one section, which the cross-row rules need. A vanished workout or section is `404`.
 */
export async function lockSectionForRecord(tx: RawClient, mode: WriteMode, workoutId: string, sectionId: string): Promise<WorkoutSectionDbRow> {
  await lockWorkoutForRecord(tx, mode, workoutId);
  return lockSectionThenRead(tx, sectionId);
}

/**
 * The same envelope for a clear, which checks no rule and so reads nothing (#245): the workout `FOR SHARE` and the
 * section `FOR UPDATE` only. The section lock still comes before the write, so a concurrent set waits for it.
 */
async function lockSectionForClear(tx: RawClient, mode: WriteMode, workoutId: string, sectionId: string): Promise<void> {
  await lockWorkoutForRecord(tx, mode, workoutId);
  await lockSectionRow(tx, sectionId);
}

async function lockWorkoutForRecord(tx: RawClient, mode: WriteMode, workoutId: string): Promise<void> {
  const workouts = await tx.$queryRaw<{ ended_at: Date | null }[]>`
    SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
  `;
  const locked = workouts[0];
  if (!locked) throw sectionNotFound();
  assertStillLive(mode, locked.ended_at);
}

/** The section row's `FOR UPDATE` alone; `404` when the section is gone. */
async function lockSectionRow(tx: RawClient, sectionId: string): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM "workout_section" WHERE id = ${sectionId}::uuid FOR UPDATE
  `;
  if (locked.length === 0) throw sectionNotFound();
}

/**
 * Locks the section row, then reads it with its round times in a SECOND statement. Under READ COMMITTED a
 * `SELECT … FOR UPDATE` that waited for the lock re-checks the locked row but evaluates its subqueries against the
 * snapshot taken before the wait, so a `round_times` read in the same statement could miss a round another writer
 * just committed — and a rule checked against it would pass when it must not (AC22 (a), found by the race test).
 */
async function lockSectionThenRead(tx: RawClient, sectionId: string): Promise<WorkoutSectionDbRow> {
  await lockSectionRow(tx, sectionId);
  const rows = await tx.$queryRaw<WorkoutSectionDbRow[]>`SELECT ${SECTION_COLUMNS} FROM "workout_section" WHERE id = ${sectionId}::uuid`;
  return rows[0]!;
}

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
        // Lock, then read the rounds and result fresh (see lockSectionThenRead): the timer change decides on them.
        const current = await lockSectionThenRead(tx, sectionId);
        const name = patch.name ?? current.name;
        const notes = "notes" in patch && patch.notes !== undefined ? patch.notes : current.notes;
        const nameChanged = name !== current.name;
        const notesChanged = notes !== current.notes;
        const stored = toWorkoutSectionRecord(current);
        // Spec 09.5 AC13 — normalize first, so `{ format: "time_cap" }` equals a stored For Time (Review Focus 4).
        const timer = patch.timer === undefined ? stored.timer : timerFromColumns(timerToColumns(patch.timer));
        const timerChanged = !timersEqual(timer, stored.timer);
        let resultCleared = false;
        if (timerChanged && !timerChangeKeepsRecorded(stored.timer, timer, stored.roundTimes, stored.result)) {
          // Before any write, so a refused timer change takes the rename with it (Review Focus 3).
          if (patch.discardResult !== true) throw new SectionResultExistsError();
          resultCleared = true;
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

    async setSectionRoundTime(actingUserId, sectionId, round, seconds) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        const current = toWorkoutSectionRecord(await lockSectionForRecord(tx, mode, pre.workout_id, sectionId));
        if (current.timer === null) throw new SectionTimerMismatchError();
        const issues = roundTimeIssues(current.timer, current.roundTimes, round, seconds);
        if (issues.length > 0) throw timerValidationError(issues);
        if (current.roundTimes.some((r) => r.round === round && r.seconds === seconds)) {
          // A replay of the stored value writes nothing (AC18).
          return { ...current, workoutId: pre.workout_id, changed: false, finishedEdit: null };
        }
        await tx.$executeRaw`
          INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds)
          VALUES (${sectionId}::uuid, ${round}, ${seconds})
          ON CONFLICT (workout_section_id, round_no) DO UPDATE SET seconds = EXCLUDED.seconds, updated_at = now()
        `;
        // The section row is locked FOR UPDATE until commit, so no other writer can change its rounds: the response is
        // the row already read plus the one round written, with no re-read (#246).
        return {
          ...current,
          roundTimes: sortedRoundTimes([...current.roundTimes.filter((r) => r.round !== round), { round, seconds }]),
          workoutId: pre.workout_id,
          changed: true,
          finishedEdit: mode === "finished" ? noRecompute(pre.workout_id) : null,
        };
      });
    },

    async clearSectionRoundTime(actingUserId, sectionId, round) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        await lockSectionForClear(tx, mode, pre.workout_id, sectionId);
        // No timer check and no rule: a clear always succeeds (AC15), and an untimed section has nothing to remove.
        const removed = await tx.$executeRaw`
          DELETE FROM "workout_section_round" WHERE workout_section_id = ${sectionId}::uuid AND round_no = ${round}
        `;
        return {
          workoutId: pre.workout_id,
          removed: removed > 0,
          finishedEdit: mode === "finished" && removed > 0 ? noRecompute(pre.workout_id) : null,
        };
      });
    },

    async setSectionResult(actingUserId, sectionId, body) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        const current = toWorkoutSectionRecord(await lockSectionForRecord(tx, mode, pre.workout_id, sectionId));
        const timer = current.timer;
        // A Set Timer's score is its round times, so it takes no result (§6.4).
        if (timer === null || timer.format === "set_timer") throw new SectionTimerMismatchError();
        const issues = resultIssues(timer, body);
        if (issues.length > 0) throw timerValidationError(issues);
        const rounds = body.rounds ?? null;
        const reps = body.reps ?? null;
        const finish = body.finishSeconds ?? null;
        const capped = body.capped ?? false;
        // Normalized before the compare, so explicit defaults are a replay (Review Focus 5).
        const updated = await tx.$queryRaw<WorkoutSectionDbRow[]>`
          UPDATE "workout_section"
          SET result_rounds = ${rounds}::smallint, result_reps = ${reps}::smallint,
              result_finish_s = ${finish}::int, result_capped = ${capped}::boolean, updated_at = now()
          WHERE id = ${sectionId}::uuid
            AND (result_rounds, result_reps, result_finish_s, result_capped)
                IS DISTINCT FROM (${rounds}::smallint, ${reps}::smallint, ${finish}::int, ${capped}::boolean)
          RETURNING ${SECTION_COLUMNS}
        `;
        if (updated.length === 0) return { ...current, workoutId: pre.workout_id, changed: false, finishedEdit: null };
        return {
          ...toWorkoutSectionRecord(updated[0]!),
          workoutId: pre.workout_id,
          changed: true,
          finishedEdit: mode === "finished" ? noRecompute(pre.workout_id) : null,
        };
      });
    },

    async clearSectionResult(actingUserId, sectionId) {
      const pre = await sectionPreflight(actingUserId, sectionId);
      return withWriteMode(prisma, actingUserId, pre.ended_at, async (tx, mode) => {
        await lockSectionForClear(tx, mode, pre.workout_id, sectionId);
        // No timer check: a clear always succeeds (AC17); the round times stay.
        const removed = await tx.$executeRaw`
          UPDATE "workout_section"
          SET result_rounds = NULL, result_reps = NULL, result_finish_s = NULL, result_capped = false, updated_at = now()
          WHERE id = ${sectionId}::uuid
            AND (result_rounds IS NOT NULL OR result_reps IS NOT NULL OR result_finish_s IS NOT NULL OR result_capped)
        `;
        return {
          workoutId: pre.workout_id,
          removed: removed > 0,
          finishedEdit: mode === "finished" && removed > 0 ? noRecompute(pre.workout_id) : null,
        };
      });
    },
  };
}
