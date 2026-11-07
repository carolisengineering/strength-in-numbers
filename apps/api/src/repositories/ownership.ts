import { Prisma } from "@prisma/client";

/**
 * Spec 21.0 §6.7, AC22 — "this row belongs to the acting user" as one SQL
 * predicate per owned table that has no owner of its own in the request, so a
 * statement keyed by a child id carries its own user filter instead of relying
 * on an earlier, separate ownership check.
 *
 * Spec 21.1 Phase A (AC7): each child table has its own `user_id` (migration
 * `0019`), filled from the parent by a trigger and tied to the parent's owner by
 * a composite foreign key. So each helper is one primary-key probe of the child
 * on its own `user_id`, with no join through the parent chain. Callers didn't
 * change.
 *
 * `ref` is a column reference from the calling statement, qualified by its table
 * or alias (`Prisma.sql\`we.id\``, `Prisma.sql\`"set_entry".id\``), never a value
 * and never `Prisma.raw`. Qualify it: a bare `id` would bind to the table inside
 * the subquery. The helpers' own aliases are prefixed `own_` so a caller's `we` /
 * `s` can't be shadowed either.
 */

type Owned = (actingUserId: string, ref: Prisma.Sql) => Prisma.Sql;

/** `workout_exercise`. */
export const ownedWorkoutExercise: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_exercise" own_we WHERE own_we.id = ${ref} AND own_we.user_id = ${actingUserId}::uuid)`;

/** `set_entry`. */
export const ownedSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "set_entry" own_s WHERE own_s.id = ${ref} AND own_s.user_id = ${actingUserId}::uuid)`;

/** `workout_planned_set`. */
export const ownedPlannedSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_planned_set" own_p WHERE own_p.id = ${ref} AND own_p.user_id = ${actingUserId}::uuid)`;

/** `workout_section`. */
export const ownedWorkoutSection: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "workout_section" own_ws WHERE own_ws.id = ${ref} AND own_ws.user_id = ${actingUserId}::uuid)`;

/**
 * `workout_section_round`. A round has no id of its own (its key is
 * `(workout_section_id, round_no)`), so `ref` is the round's `workout_section_id`
 * and the predicate is its section's: the composite key makes a round's owner its
 * section's owner.
 */
export const ownedSectionRound: Owned = ownedWorkoutSection;

/** `routine_item`. */
export const ownedRoutineItem: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_item" own_ri WHERE own_ri.id = ${ref} AND own_ri.user_id = ${actingUserId}::uuid)`;

/** `routine_item_set`. */
export const ownedRoutineItemSet: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_item_set" own_ris WHERE own_ris.id = ${ref} AND own_ris.user_id = ${actingUserId}::uuid)`;

/** `routine_section`. */
export const ownedRoutineSection: Owned = (actingUserId, ref) => Prisma.sql`EXISTS (
  SELECT 1 FROM "routine_section" own_rs WHERE own_rs.id = ${ref} AND own_rs.user_id = ${actingUserId}::uuid)`;
