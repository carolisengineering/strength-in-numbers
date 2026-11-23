// apps/api/src/db/rls-tables.ts
/**
 * Spec 21.1 §4.1 — the 19 application tables under row-level security. `_prisma_migrations` is never one of them: it
 * has no policy and `sin_app` holds no privilege on it. Migration `0021` and the `db:rls` kill switch cover exactly this
 * list; the table inventory test fails if a new table is missing from it.
 */
export const RLS_TABLES: readonly string[] = [
  "user",
  "exercise",
  "muscle_group",
  "equipment",
  "workout",
  "routine",
  "personal_record",
  "hevy_exercise_pair",
  "hevy_section_rule",
  "hevy_link",
  "hevy_account",
  "workout_exercise",
  "workout_section",
  "set_entry",
  "workout_planned_set",
  "workout_section_round",
  "routine_item",
  "routine_section",
  "routine_item_set",
];

/**
 * The order `0020`, `0021` and `db:rls` take their table locks in: a fixed order, so two runs never wait on each other,
 * with each parent before its children (routine before workout). It is not the API's whole lock order: the API takes the
 * user row first (`resolveUser`), so a request can hold `"user"` while this waits behind it; `db:rls`'s lock timeout
 * bounds that wait, and the command can be run again (minor 438). Same tables as `RLS_TABLES`.
 */
export const RLS_LOCK_ORDER: readonly string[] = [
  "routine",
  "workout",
  "routine_item",
  "routine_section",
  "routine_item_set",
  "workout_exercise",
  "workout_section",
  "set_entry",
  "workout_planned_set",
  "workout_section_round",
  "personal_record",
  "hevy_exercise_pair",
  "hevy_section_rule",
  "hevy_link",
  "hevy_account",
  "exercise",
  "user",
  "muscle_group",
  "equipment",
];

/** A double-quoted SQL identifier. Only ever given names from `RLS_TABLES`; embedded quotes are doubled regardless. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
