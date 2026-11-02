// apps/api/test/integration/section-helpers.ts
import { expect } from "vitest";
import { uuidv7 } from "uuidv7";
import type { RoundTime, SectionResult, SectionTimer } from "@sin/core";
import type { IntegrationDb } from "./helpers.js";
import { logWorkout } from "./records-helpers.js";

/**
 * Spec 09.2 AC29 — the single-column foreign keys cannot say "the section belongs to the SAME routine
 * / workout", so the test side does: every item's section belongs to its own routine, every exercise's
 * section to its own workout, and each parent's section positions are dense from 0.
 */
export async function assertSectionsConsistent(db: IntegrationDb): Promise<void> {
  const q = (sql: string) => db.prisma.$queryRawUnsafe<{ id: string }[]>(sql);
  expect(
    await q(`SELECT ri.id::text FROM "routine_item" ri JOIN "routine_section" s ON s.id = ri.section_id WHERE s.routine_id <> ri.routine_id`),
    "routine items whose section belongs to another routine",
  ).toEqual([]);
  expect(
    await q(`SELECT we.id::text FROM "workout_exercise" we JOIN "workout_section" s ON s.id = we.section_id WHERE s.workout_id <> we.workout_id`),
    "workout exercises whose section belongs to another workout",
  ).toEqual([]);
  for (const [table, fk] of [["routine_section", "routine_id"], ["workout_section", "workout_id"]] as const) {
    expect(
      await q(`SELECT ${fk}::text AS id FROM "${table}" GROUP BY ${fk} HAVING min(position) <> 0 OR max(position) + 1 <> count(*)`),
      `${table} positions not dense from 0`,
    ).toEqual([]);
  }
  // Spec 09.5 AC34 — the cross-row round rules a CHECK cannot see, and the result shape per format.
  expect(
    await q(`SELECT r.workout_section_id::text AS id FROM "workout_section_round" r JOIN "workout_section" s ON s.id = r.workout_section_id
             WHERE s.timer_format IS NULL`),
    "round rows on an untimed section",
  ).toEqual([]);
  expect(
    await q(`SELECT r.workout_section_id::text AS id FROM "workout_section_round" r JOIN "workout_section" s ON s.id = r.workout_section_id
             WHERE s.timer_format = 'set_timer' AND (r.round_no > s.timer_rounds OR r.seconds > s.timer_round_s)`),
    "Set Timer round rows outside the plan",
  ).toEqual([]);
  expect(
    await q(`SELECT r.workout_section_id::text AS id FROM "workout_section_round" r JOIN "workout_section" s ON s.id = r.workout_section_id
             WHERE s.timer_format IN ('amrap', 'time_cap') AND s.timer_cap_s IS NOT NULL AND r.seconds > s.timer_cap_s`),
    "AMRAP / Time Cap readings past the cap",
  ).toEqual([]);
  expect(
    await q(`SELECT id FROM (
               SELECT r.workout_section_id::text AS id, r.seconds,
                      lag(r.seconds) OVER (PARTITION BY r.workout_section_id ORDER BY r.round_no) AS previous
               FROM "workout_section_round" r JOIN "workout_section" s ON s.id = r.workout_section_id
               WHERE s.timer_format IN ('amrap', 'time_cap')) t
             WHERE previous >= seconds`),
    "AMRAP / Time Cap readings not strictly increasing",
  ).toEqual([]);
  expect(
    await q(`SELECT id::text FROM "workout_section"
             WHERE (result_rounds IS NOT NULL OR result_reps IS NOT NULL OR result_finish_s IS NOT NULL OR result_capped)
               AND (timer_format IS NULL OR timer_format = 'set_timer')`),
    "result columns on a section whose format cannot hold them",
  ).toEqual([]);
}

export async function insertWorkoutSection(
  db: IntegrationDb, workoutId: string, position: number, name: string, notes: string | null = null,
): Promise<string> {
  const id = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_section" (id, workout_id, position, name, notes) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
    id, workoutId, position, name, notes,
  );
  return id;
}

export async function setExerciseSection(db: IntegrationDb, workoutExerciseId: string, sectionId: string | null): Promise<void> {
  await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET section_id = $2::uuid WHERE id = $1::uuid`, workoutExerciseId, sectionId);
}

export async function exerciseIdsOf(db: IntegrationDb, workoutId: string): Promise<string[]> {
  const rows = await db.prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
  return rows.map((r) => r.id);
}

/** Spec 09.4 — a section as `POST /v1/workouts/{id}/sections` leaves it (`added_in_workout = true`), by raw SQL. */
export async function addWorkoutSection(
  db: IntegrationDb, workoutId: string, position: number, name: string, notes: string | null = null,
): Promise<string> {
  const id = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout) VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)`,
    id, workoutId, position, name, notes,
  );
  return id;
}

/**
 * Spec 09.4 — a workout with `sections` (copied unless `added`) and one exercise per `exercises` entry,
 * in list order: a number is the index of the section it sits in, `null` is loose. Each exercise gets
 * one complete working set when `finished`, so a finished fixture is a legal finished workout.
 */
export async function workoutWithSections(
  db: IntegrationDb,
  userId: string,
  exerciseId: string,
  spec: { sections: { name: string; added?: boolean; notes?: string | null }[]; exercises: (number | null)[]; finished?: boolean },
): Promise<{ workoutId: string; sectionIds: string[]; exerciseIds: string[] }> {
  const { workoutId } = await logWorkout(db, userId, {
    startedAt: new Date(Date.now() - 7_200_000),
    finish: spec.finished ? "raw" : "none",
    exercises: spec.exercises.map(() => ({ exerciseId, sets: spec.finished ? [{ reps: 5, weight: 100 }] : [] })),
  });
  const sectionIds: string[] = [];
  for (const [position, s] of spec.sections.entries()) {
    const insert = s.added ? addWorkoutSection : insertWorkoutSection;
    sectionIds.push(await insert(db, workoutId, position, s.name, s.notes ?? null));
  }
  const exerciseIds = await exerciseIdsOf(db, workoutId);
  for (const [i, ref] of spec.exercises.entries()) {
    if (ref !== null) await setExerciseSection(db, exerciseIds[i]!, sectionIds[ref]!);
  }
  return { workoutId, sectionIds, exerciseIds };
}

/** Spec 09.5 — a timed section by raw SQL (Phase A has no workout-side timer write route). */
export async function addTimedSection(
  db: IntegrationDb, workoutId: string, position: number, name: string, timer: SectionTimer,
): Promise<string> {
  const id = uuidv7();
  const roundS = timer.format === "set_timer" ? timer.roundSeconds : null;
  const rounds = timer.format === "set_timer" ? timer.rounds : null;
  const capS = timer.format === "set_timer" ? null : timer.capSeconds;
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_section" (id, workout_id, position, name, timer_format, timer_round_s, timer_rounds, timer_cap_s)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
    id, workoutId, position, name, timer.format, roundS, rounds, capS,
  );
  return id;
}

/** Spec 09.5 — round rows by raw SQL (any order; replaces a round that exists). */
export async function recordRounds(db: IntegrationDb, sectionId: string, rounds: readonly RoundTime[]): Promise<void> {
  for (const r of rounds) {
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (workout_section_id, round_no) DO UPDATE SET seconds = EXCLUDED.seconds`,
      sectionId, r.round, r.seconds,
    );
  }
}

/** Spec 09.5 — a section's result columns by raw SQL. */
export async function setResult(db: IntegrationDb, sectionId: string, result: SectionResult): Promise<void> {
  await db.prisma.$executeRawUnsafe(
    `UPDATE "workout_section" SET result_rounds = $2, result_reps = $3, result_finish_s = $4, result_capped = $5 WHERE id = $1::uuid`,
    sectionId, result.rounds, result.reps, result.finishSeconds, result.capped,
  );
}
