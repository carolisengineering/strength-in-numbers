// apps/api/test/integration/section-helpers.ts
import { expect } from "vitest";
import { uuidv7 } from "uuidv7";
import type { IntegrationDb } from "./helpers.js";

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
