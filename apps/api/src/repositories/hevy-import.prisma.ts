import type { Prisma, PrismaClient } from "@prisma/client";
import type { DuplicateSide, HevyImportContext, ImportExerciseInfo, Modality, UnitPreference } from "@sin/core";
import { readHevyMapping } from "./hevy.prisma.js";
import type { HevyLinkHit } from "./hevy-import.js";

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
