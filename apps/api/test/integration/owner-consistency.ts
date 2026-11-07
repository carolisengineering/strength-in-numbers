import type { IntegrationDb } from "./helpers.js";

/**
 * Spec 21.1 §4.2 — the eight parent → child links that `0019` gives an owner column, parents first.
 * `oldFkey` is the single-column foreign key `0019` replaces with a composite `(parent id, user_id)` one.
 */
export const CHILD_LINKS = [
  { child: "workout_exercise", column: "workout_id", parent: "workout", oldFkey: "workout_exercise_workout_id_fkey" },
  { child: "workout_section", column: "workout_id", parent: "workout", oldFkey: "workout_section_workout_fkey" },
  { child: "set_entry", column: "workout_exercise_id", parent: "workout_exercise", oldFkey: "set_entry_workout_exercise_id_fkey" },
  { child: "workout_planned_set", column: "workout_exercise_id", parent: "workout_exercise", oldFkey: "workout_planned_set_exercise_fkey" },
  { child: "workout_section_round", column: "workout_section_id", parent: "workout_section", oldFkey: "workout_section_round_section_fkey" },
  { child: "routine_item", column: "routine_id", parent: "routine", oldFkey: "routine_item_routine_id_fkey" },
  { child: "routine_section", column: "routine_id", parent: "routine", oldFkey: "routine_section_routine_fkey" },
  { child: "routine_item_set", column: "routine_item_id", parent: "routine_item", oldFkey: "routine_item_set_item_fkey" },
] as const;

export type ChildTable = (typeof CHILD_LINKS)[number]["child"];

/**
 * Spec 21.1 AC1 — the consistency query: for each child table, the number of rows whose `user_id` differs from
 * its parent's (NULL counts as different). Every count must be 0. The runbook's staging step pastes this text.
 */
export const OWNER_CONSISTENCY_SQL = CHILD_LINKS.map(
  ({ child, column, parent }) =>
    `SELECT '${child}' AS t, count(*)::int AS n FROM "${child}" c JOIN "${parent}" p ON p.id = c.${column} WHERE c.user_id IS DISTINCT FROM p.user_id`,
).join("\nUNION ALL ");

/** Runs {@link OWNER_CONSISTENCY_SQL}; every value is 0 on a consistent database. */
export async function ownerMismatches(db: Pick<IntegrationDb, "prisma">): Promise<Record<ChildTable, number>> {
  const rows = await db.prisma.$queryRawUnsafe<{ t: ChildTable; n: number }[]>(OWNER_CONSISTENCY_SQL);
  return Object.fromEntries(rows.map((r) => [r.t, r.n])) as Record<ChildTable, number>;
}
