import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ROUTINE_SECTIONS_MAX,
  type DuplicateSide,
  type HevyImportContext,
  type ImportedWorkout,
  type ImportExerciseInfo,
  type Modality,
  type UnitPreference,
} from "@sin/core";
import { uuidv7 } from "uuidv7";
import { ValidationError } from "../errors/app-error.js";
import { fingerprintSourceOf, hevyFingerprint } from "../hevy/fingerprint.js";
import { readHevyMapping } from "./hevy.prisma.js";
import type { HevyImportRepository, HevyImportSeams, HevyImportWriteStep, HevyLinkHit, WriteOutcome } from "./hevy-import.js";
import type { RawPrismaError } from "./pg-errors.js";
import { assertSetMeasuresValid } from "./set-writes.js";
import { readWorkoutDetail } from "./workout.prisma.js";

/** A transaction or the client itself: the reads run on either. */
type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Spec 19.1 §6.1: what one import request reads once — the mapping, the exercises it names, the user's unit. Every
 * statement is scoped to `userId`.
 */
export async function loadContext(client: Db, userId: string, now: Date): Promise<HevyImportContext> {
  const mapping = await readHevyMapping(client, userId);
  const ids = [...new Set(mapping.pairs.flatMap((p) => (p.exerciseId === null ? [] : [p.exerciseId])))];
  const rows =
    ids.length === 0
      ? []
      : await client.$queryRaw<{ id: string; name: string; modality: string; is_active: boolean; root_id: string }[]>`
          SELECT id::text, name, modality, is_active, COALESCE(forked_from_exercise_id, id)::text AS root_id
          FROM "exercise"
          WHERE id = ANY(${ids}::uuid[]) AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)`;
  const exercises = new Map<string, ImportExerciseInfo>(
    rows.map((r) => [r.id, { name: r.name, modality: r.modality as Modality, active: r.is_active, rootId: r.root_id }]),
  );
  const user = await client.$queryRaw<{ unit_preference: string }[]>`
    SELECT unit_preference FROM "user" WHERE id = ${userId}::uuid`;
  return {
    pairs: new Map(mapping.pairs.map((p) => [p.hevyTemplateId, p])),
    exercises,
    unit: (user[0]?.unit_preference ?? "kg") as UnitPreference,
    now,
  };
}

/** AC20: the caller's links for these Hevy ids, in one statement (`hevy_link_hevy_id_key`). */
export async function findLinks(client: Db, userId: string, hevyIds: readonly string[]): Promise<Map<string, HevyLinkHit>> {
  if (hevyIds.length === 0) return new Map();
  const rows = await client.$queryRaw<{ hevy_workout_id: string; workout_id: string | null; origin: HevyLinkHit["origin"] }[]>`
    SELECT hevy_workout_id, workout_id::text AS workout_id, origin
    FROM "hevy_link"
    WHERE user_id = ${userId}::uuid AND hevy_workout_id = ANY(${[...hevyIds]}::text[])`;
  return new Map(rows.map((r) => [r.hevy_workout_id, { workoutId: r.workout_id, origin: r.origin }]));
}

/**
 * AC21, §6.3: the caller's finished, unlinked workouts on `localDate` starting within an hour of `startedAt`, with
 * their lineage roots. The SQL narrows; `isDuplicateWorkout` decides.
 */
export async function findCandidates(
  client: Db,
  userId: string,
  localDate: string,
  startedAt: string,
): Promise<(DuplicateSide & { id: string })[]> {
  const rows = await client.$queryRaw<{ id: string; title: string | null; started_at: string; local_date: string; roots: string[] }[]>`
    SELECT w.id::text, w.title,
           to_char(w.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
           to_char(w.local_date, 'YYYY-MM-DD') AS local_date,
           array_agg(DISTINCT COALESCE(e.forked_from_exercise_id, e.id)::text) AS roots
    FROM "workout" w
    JOIN "workout_exercise" we ON we.workout_id = w.id
    JOIN "exercise" e ON e.id = we.exercise_id
    WHERE w.user_id = ${userId}::uuid AND w.ended_at IS NOT NULL AND w.local_date = ${localDate}::date
      AND w.started_at BETWEEN ${startedAt}::timestamptz - interval '1 hour' AND ${startedAt}::timestamptz + interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM "hevy_link" l WHERE l.workout_id = w.id AND l.hevy_workout_id IS NOT NULL)
    GROUP BY w.id`;
  return rows.map((r) => ({ id: r.id, title: r.title, startedAt: r.started_at, localDate: r.local_date, rootIds: r.roots }));
}

/** Rows per multi-row `set_entry` insert: 13 parameters a row stays well under Postgres's 65 535 (200 × 200 sets). */
const SET_ROWS_PER_STATEMENT = 1_000;

/** Thrown inside the write transaction when the link insert finds the Hevy id taken; rolls the workout back. */
class AlreadyLinkedSignal extends Error {}
/** Thrown inside the write transaction when an exercise is no longer usable; rolls back, answers `rejected`. */
class RejectedSignal extends Error {}

/**
 * AC18: the Postgres failures that mean "this body breaks an invariant" — an FK (an exercise deleted since the
 * context load), a CHECK, a numeric overflow. Anything else is unexpected and rethrown (AC24).
 */
const REJECTED_SQLSTATES: ReadonlySet<string> = new Set(["23503", "23514", "22003"]);

function isRejectedDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as RawPrismaError;
  return e.code === "P2010" && REJECTED_SQLSTATES.has(e.meta?.code ?? "");
}

/**
 * §6.4: the finished-workout rules, re-checked on the translated body before any statement (the translator enforces
 * them by dropping; this is the last line). Throws `ValidationError`.
 */
function assertImportable(w: ImportedWorkout): void {
  const invalid = (message: string) => new ValidationError([{ path: "workout", message }], "hevy import: invariant");
  if (Date.parse(w.endedAt) < Date.parse(w.startedAt)) throw invalid("ends before it starts");
  if (w.sections.length > ROUTINE_SECTIONS_MAX) throw invalid("too many sections");
  if (w.exercises.length === 0) throw invalid("no exercises");
  for (const e of w.exercises) {
    if (e.sets.length === 0) throw invalid("an exercise with no sets");
    if (e.sectionIndex !== null && (e.sectionIndex < 0 || e.sectionIndex >= w.sections.length)) throw invalid("unknown section");
    for (const s of e.sets) {
      assertSetMeasuresValid(e.modalitySnapshot, {
        setType: s.setType,
        reps: s.reps,
        weight: s.weight,
        weightUnit: s.weightUnit,
        distance: s.distance,
        distanceUnit: s.distanceUnit,
        durationS: s.durationS,
        calories: s.calories,
        isComplete: true,
      });
    }
  }
}

export function createHevyImportRepository(prisma: PrismaClient, seams: HevyImportSeams = {}): HevyImportRepository {
  const step = async (s: HevyImportWriteStep) => {
    await seams.onWriteStep?.(s);
  };

  async function writeImportedWorkout(userId: string, hevyWorkoutId: string, w: ImportedWorkout): Promise<WriteOutcome> {
    try {
      assertImportable(w);
    } catch (err) {
      if (err instanceof ValidationError) return { kind: "rejected" };
      throw err;
    }

    const workoutId = uuidv7();
    const sectionIds = w.sections.map(() => uuidv7());
    const exerciseIds = w.exercises.map(() => uuidv7());
    try {
      await prisma.$transaction(
        async (tx) => {
          // An exercise retired since the context load raises no FK error; check it in the transaction (AC18).
          const ids = [...new Set(w.exercises.map((e) => e.exerciseId))];
          const usable = await tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "exercise"
            WHERE id = ANY(${ids}::uuid[]) AND is_active AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)`;
          if (usable[0]!.n !== ids.length) throw new RejectedSignal();

          await tx.$executeRaw`
            INSERT INTO "workout"
              (id, user_id, title, notes, started_at, ended_at, local_date, tz_offset_minutes,
               client_generated_id, source, created_at, updated_at)
            VALUES
              (${workoutId}::uuid, ${userId}::uuid, ${w.title}, ${w.notes}, ${w.startedAt}::timestamptz,
               ${w.endedAt}::timestamptz, ${w.localDate}::date, ${w.tzOffsetMinutes}, ${uuidv7()}::uuid, 'hevy', now(), now())`;
          await step("workout");

          if (w.sections.length > 0) {
            await tx.$executeRaw`
              INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout, created_at, updated_at)
              VALUES ${Prisma.join(
                w.sections.map(
                  (s, i) => Prisma.sql`(${sectionIds[i]}::uuid, ${workoutId}::uuid, ${i}, ${s.name}, ${s.notes}, false, now(), now())`,
                ),
              )}`;
          }
          await step("sections");

          await tx.$executeRaw`
            INSERT INTO "workout_exercise"
              (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, notes, superset_group,
               section_id, created_at, updated_at)
            VALUES ${Prisma.join(
              w.exercises.map(
                (e, i) => Prisma.sql`(${exerciseIds[i]}::uuid, ${workoutId}::uuid, ${i}, ${e.exerciseId}::uuid, ${e.nameSnapshot},
                  ${e.modalitySnapshot}, ${e.notes}, ${e.supersetGroup}::smallint,
                  ${e.sectionIndex === null ? null : sectionIds[e.sectionIndex]}::uuid, now(), now())`,
              ),
            )}`;
          await step("exercises");

          const setRows = w.exercises.flatMap((e, i) =>
            e.sets.map(
              (s) => Prisma.sql`(${uuidv7()}::uuid, ${exerciseIds[i]}::uuid, ${s.setNumber}::smallint, ${s.setType},
                ${s.reps}::smallint, ${s.weight}::numeric, ${s.weightUnit}, ${s.distance}::numeric, ${s.distanceUnit},
                ${s.durationS}::integer, ${s.calories}::smallint, ${s.rpe}::numeric, true, NULL, now(), now())`,
            ),
          );
          for (let i = 0; i < setRows.length; i += SET_ROWS_PER_STATEMENT) {
            await tx.$executeRaw`
              INSERT INTO "set_entry"
                (id, workout_exercise_id, set_number, set_type, reps, weight, weight_unit, distance, distance_unit,
                 duration_s, calories, rpe, is_complete, completed_at, created_at, updated_at)
              VALUES ${Prisma.join(setRows.slice(i, i + SET_ROWS_PER_STATEMENT))}`;
          }
          await step("sets");

          // §6.2: the fingerprint of the workout as stored, through the same reader the link begin uses.
          const detail = await readWorkoutDetail(tx, userId, workoutId);
          const fingerprint = hevyFingerprint(fingerprintSourceOf(detail!));
          const linked = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "hevy_link" (id, user_id, workout_id, hevy_workout_id, origin, synced_fingerprint, synced_at)
            VALUES (${uuidv7()}::uuid, ${userId}::uuid, ${workoutId}::uuid, ${hevyWorkoutId}, 'imported', ${fingerprint}, now())
            ON CONFLICT (user_id, hevy_workout_id) WHERE hevy_workout_id IS NOT NULL DO NOTHING
            RETURNING id::text`;
          if (linked.length === 0) throw new AlreadyLinkedSignal();
          await step("link");

          // AC25: the flag rides in the same transaction as the workout.
          await tx.$executeRaw`
            INSERT INTO "hevy_account" (user_id, records_stale) VALUES (${userId}::uuid, true)
            ON CONFLICT (user_id) DO UPDATE SET records_stale = true, updated_at = now()`;
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (err instanceof AlreadyLinkedSignal) return { kind: "already_linked" };
      if (err instanceof RejectedSignal || isRejectedDbError(err)) return { kind: "rejected" };
      throw err;
    }
    return { kind: "created", workoutId };
  }

  return { writeImportedWorkout };
}
