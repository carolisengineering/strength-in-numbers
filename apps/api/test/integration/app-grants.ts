// apps/api/test/integration/app-grants.ts
/**
 * Spec 21.1 §6.7 — the allow-list: exactly what `sin_app` may do, per table. Migration `0020` grants it; the grants test
 * compares the database against it; the `UPDATE`-columns scan compares the code against it; Phase D's table inventory
 * reuses it. A new table or column grant is added here and in its migration together.
 */

export type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface TableGrant {
  /** Table-level privileges. */
  table: readonly Privilege[];
  /** Column-level privileges, for tables with no table-level `UPDATE`. */
  columns?: { UPDATE: readonly string[] };
}

const OWNED: TableGrant = { table: ["SELECT", "INSERT", "UPDATE", "DELETE"] };

export const OWNED_TABLES = [
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
] as const;

export const APP_GRANTS: Readonly<Record<string, TableGrant>> = {
  ...Object.fromEntries(OWNED_TABLES.map((t) => [t, OWNED])),
  user: {
    table: ["SELECT", "INSERT"],
    columns: { UPDATE: ["email", "email_verified", "display_name", "unit_preference", "timezone", "updated_at", "deleted_at"] },
  },
  exercise: {
    table: ["SELECT", "INSERT"],
    columns: { UPDATE: ["name", "modality", "primary_muscle_id", "secondary_muscle_ids", "equipment_id", "is_active", "updated_at"] },
  },
  muscle_group: { table: ["SELECT"] },
  equipment: { table: ["SELECT"] },
};
