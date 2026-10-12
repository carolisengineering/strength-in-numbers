import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { IntegrationDb } from "./helpers.js";

const MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/0010_create_planned_sets/migration.sql", import.meta.url),
);

/** The migration's real backfill statement (between the BACKFILL markers). */
export const BACKFILL_SQL: string = (() => {
  const text = readFileSync(MIGRATION, "utf8");
  const start = text.indexOf("-- BACKFILL-BEGIN");
  const end = text.indexOf("-- BACKFILL-END");
  return text.slice(start + "-- BACKFILL-BEGIN".length, end).trim().replace(/;\s*$/, "");
})();

/** AC8 / AC14 — for every routine item and every workout exercise that has
 * planned rows, the target columns equal what deriveTargets would give. Items
 * without rows are skipped (the O1 exception and pre-0010 workouts). */
export async function assertDerivedColumnsConsistent(db: IntegrationDb): Promise<void> {
  for (const [parent, child, fk] of [
    ["routine_item", "routine_item_set", "routine_item_id"],
    ["workout_exercise", "workout_planned_set", "workout_exercise_id"],
  ] as const) {
    const bad = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT p.id::text FROM "${parent}" p
      JOIN (SELECT ${fk} AS pid, count(*)::int AS n,
                   min(reps_low) AS lo, max(reps_high) AS hi
            FROM "${child}" GROUP BY ${fk}) c ON c.pid = p.id
      WHERE p.target_sets IS DISTINCT FROM c.n
         OR p.target_reps_low IS DISTINCT FROM c.lo
         OR p.target_reps_high IS DISTINCT FROM c.hi`);
    expect(bad, `${parent} rows whose derived columns disagree with ${child}`).toEqual([]);
  }
  const orphanCount = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT ri.id::text FROM "routine_item" ri
    WHERE ri.target_sets IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "routine_item_set" s WHERE s.routine_item_id = ri.id)`);
  expect(orphanCount, "routine items with a set count but no rows").toEqual([]);
}
