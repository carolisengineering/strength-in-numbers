import type { IntegrationDb } from "../helpers.js";

/**
 * Spec 21.0 §4, §6.4 — what a user owns, and a canonical snapshot of it.
 *
 * `OWNERSHIP_MAP` follows spec §4: every table reachable from `"user"` by a
 * foreign key, with the SQL that selects one user's rows (`$1` = the user id)
 * through the ownership path. Each statement returns every column of every row,
 * ordered by the primary key, so a snapshot changes when any column changes,
 * `updated_at` included.
 */
const row = (alias: string) => `to_jsonb(${alias}) AS r`;

export const OWNERSHIP_MAP: Record<string, string> = {
  user: `SELECT ${row("t")} FROM "user" t WHERE t.id = $1::uuid ORDER BY t.id`,
  exercise: `SELECT ${row("t")} FROM "exercise" t WHERE t.owner_user_id = $1::uuid ORDER BY t.id`,
  workout: `SELECT ${row("t")} FROM "workout" t WHERE t.user_id = $1::uuid ORDER BY t.id`,
  routine: `SELECT ${row("t")} FROM "routine" t WHERE t.user_id = $1::uuid ORDER BY t.id`,
  personal_record: `SELECT ${row("t")} FROM "personal_record" t WHERE t.user_id = $1::uuid ORDER BY t.id`,
  hevy_exercise_pair: `SELECT ${row("t")} FROM "hevy_exercise_pair" t WHERE t.user_id = $1::uuid ORDER BY t.hevy_template_id`,
  hevy_section_rule: `SELECT ${row("t")} FROM "hevy_section_rule" t WHERE t.user_id = $1::uuid ORDER BY t.name_key`,
  hevy_link: `SELECT ${row("t")} FROM "hevy_link" t WHERE t.user_id = $1::uuid ORDER BY t.id`,
  hevy_account: `SELECT ${row("t")} FROM "hevy_account" t WHERE t.user_id = $1::uuid`,
  workout_exercise: `SELECT ${row("t")} FROM "workout_exercise" t JOIN "workout" w ON w.id = t.workout_id WHERE w.user_id = $1::uuid ORDER BY t.id`,
  workout_section: `SELECT ${row("t")} FROM "workout_section" t JOIN "workout" w ON w.id = t.workout_id WHERE w.user_id = $1::uuid ORDER BY t.id`,
  set_entry: `SELECT ${row("t")} FROM "set_entry" t JOIN "workout_exercise" we ON we.id = t.workout_exercise_id JOIN "workout" w ON w.id = we.workout_id WHERE w.user_id = $1::uuid ORDER BY t.id`,
  workout_planned_set: `SELECT ${row("t")} FROM "workout_planned_set" t JOIN "workout_exercise" we ON we.id = t.workout_exercise_id JOIN "workout" w ON w.id = we.workout_id WHERE w.user_id = $1::uuid ORDER BY t.id`,
  workout_section_round: `SELECT ${row("t")} FROM "workout_section_round" t JOIN "workout_section" ws ON ws.id = t.workout_section_id JOIN "workout" w ON w.id = ws.workout_id WHERE w.user_id = $1::uuid ORDER BY t.workout_section_id, t.round_no`,
  routine_item: `SELECT ${row("t")} FROM "routine_item" t JOIN "routine" r ON r.id = t.routine_id WHERE r.user_id = $1::uuid ORDER BY t.id`,
  routine_section: `SELECT ${row("t")} FROM "routine_section" t JOIN "routine" r ON r.id = t.routine_id WHERE r.user_id = $1::uuid ORDER BY t.id`,
  routine_item_set: `SELECT ${row("t")} FROM "routine_item_set" t JOIN "routine_item" ri ON ri.id = t.routine_item_id JOIN "routine" r ON r.id = ri.routine_id WHERE r.user_id = $1::uuid ORDER BY t.id`,
};

/** Shared reference data every user can read; a cross-user call must not change it either (AC9). */
const CATALOG_SQL: Record<string, string> = {
  catalog_exercise: `SELECT ${row("t")} FROM "exercise" t WHERE t.owner_user_id IS NULL ORDER BY t.id`,
  muscle_group: `SELECT ${row("t")} FROM "muscle_group" t ORDER BY t.id`,
  equipment: `SELECT ${row("t")} FROM "equipment" t ORDER BY t.id`,
};

/** Canonical JSON of every row the user owns, plus the shared catalog rows. */
export async function snapshot(db: Pick<IntegrationDb, "prisma">, userId: string): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const [table, sql] of Object.entries(OWNERSHIP_MAP)) {
    const rows = await db.prisma.$queryRawUnsafe<{ r: unknown }[]>(sql, userId);
    out[table] = rows.map((x) => x.r);
  }
  for (const [name, sql] of Object.entries(CATALOG_SQL)) {
    const rows = await db.prisma.$queryRawUnsafe<{ r: unknown }[]>(sql);
    out[name] = rows.map((x) => x.r);
  }
  return JSON.stringify(out);
}

/** Every `id` of every row the user owns (the leak scan's id list). */
export async function ownedIds(db: Pick<IntegrationDb, "prisma">, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const sql of Object.values(OWNERSHIP_MAP)) {
    const rows = await db.prisma.$queryRawUnsafe<{ r: { id?: unknown } }[]>(sql, userId);
    for (const { r } of rows) if (typeof r.id === "string") ids.add(r.id);
  }
  return [...ids];
}

/**
 * Review Focus 2 — every table a foreign-key path leads to from `"user"`, found
 * from `pg_constraint` the way the purge test does, so a table a later spec adds
 * can't hide from the snapshot.
 */
export async function userReachableTables(db: Pick<IntegrationDb, "prisma">): Promise<string[]> {
  const edges = await db.prisma.$queryRawUnsafe<{ child: string; parent: string }[]>(`
    SELECT replace(c.conrelid::regclass::text, '"', '') AS child, replace(c.confrelid::regclass::text, '"', '') AS parent
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  const reached = new Set(["user"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (reached.has(e.parent) && !reached.has(e.child)) {
        reached.add(e.child);
        grew = true;
      }
    }
  }
  return [...reached];
}
