import { Prisma } from "@prisma/client";

/**
 * Spec 21.0 §6.7, AC22 — "this row belongs to the acting user" as one SQL
 * predicate per owned table that has no `user_id` column of its own. Each
 * expands to an `EXISTS` through the parent chain to the root table's
 * `user_id`, so a statement keyed by a child id can carry its own user filter
 * instead of relying on an earlier, separate ownership check.
 *
 * `ref` is a column reference from the calling statement, qualified by its table
 * or alias (`Prisma.sql\`we.id\``, `Prisma.sql\`"set_entry".id\``), never a value
 * and never `Prisma.raw`. Qualify it: a bare `id` would bind to a table inside the
 * subquery. The helpers' own aliases are prefixed `own_` so a caller's `we` / `w`
 * can't be shadowed either.
 *
 * Spec 21.1 Phase A gives these tables their own `user_id`; it rewrites the
 * bodies here to a direct `… user_id = …` and no caller changes.
 */

type Owned = (actingUserId: string, ref: Prisma.Sql) => Prisma.Sql;

/** `workout_exercise` → `workout`. */
export const ownedWorkoutExercise: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_exercise" own_we JOIN "workout" own_w ON own_w.id = own_we.workout_id
  WHERE own_we.id = ${ref} AND own_w.user_id = ${actingUserId}::uuid)`;

/** `set_entry` → `workout_exercise` → `workout`. */
export const ownedSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "set_entry" own_s
  JOIN "workout_exercise" own_we ON own_we.id = own_s.workout_exercise_id
  JOIN "workout" own_w ON own_w.id = own_we.workout_id
  WHERE own_s.id = ${ref} AND own_w.user_id = ${actingUserId}::uuid)`;

/** `workout_planned_set` → `workout_exercise` → `workout`. */
export const ownedPlannedSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_planned_set" own_p
  JOIN "workout_exercise" own_we ON own_we.id = own_p.workout_exercise_id
  JOIN "workout" own_w ON own_w.id = own_we.workout_id
  WHERE own_p.id = ${ref} AND own_w.user_id = ${actingUserId}::uuid)`;

/** `workout_section` → `workout`. */
export const ownedWorkoutSection: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_section" own_ws JOIN "workout" own_w ON own_w.id = own_ws.workout_id
  WHERE own_ws.id = ${ref} AND own_w.user_id = ${actingUserId}::uuid)`;

/**
 * `workout_section_round` → `workout_section` → `workout`. A round has no id of
 * its own (its key is `(workout_section_id, round_no)`), so `ref` is the round's
 * `workout_section_id`.
 */
export const ownedSectionRound: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_section" own_ws JOIN "workout" own_w ON own_w.id = own_ws.workout_id
  WHERE own_ws.id = ${ref} AND own_w.user_id = ${actingUserId}::uuid)`;

/** `routine_item` → `routine`. */
export const ownedRoutineItem: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_item" own_ri JOIN "routine" own_r ON own_r.id = own_ri.routine_id
  WHERE own_ri.id = ${ref} AND own_r.user_id = ${actingUserId}::uuid)`;

/** `routine_item_set` → `routine_item` → `routine`. */
export const ownedRoutineItemSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_item_set" own_ris
  JOIN "routine_item" own_ri ON own_ri.id = own_ris.routine_item_id
  JOIN "routine" own_r ON own_r.id = own_ri.routine_id
  WHERE own_ris.id = ${ref} AND own_r.user_id = ${actingUserId}::uuid)`;

/** `routine_section` → `routine`. */
export const ownedRoutineSection: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_section" own_rs JOIN "routine" own_r ON own_r.id = own_rs.routine_id
  WHERE own_rs.id = ${ref} AND own_r.user_id = ${actingUserId}::uuid)`;
