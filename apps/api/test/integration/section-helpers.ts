// apps/api/test/integration/section-helpers.ts
import { expect } from "vitest";
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
