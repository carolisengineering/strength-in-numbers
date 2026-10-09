// apps/api/src/repositories/routine.prisma.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { ROUTINES_PER_USER_MAX, isRoutineId, normalizeSupersetGroups, rpeToTenths } from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  ExerciseRetiredError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import { isRawUniqueViolation, violatedConstraintColumns } from "./pg-errors.js";
import type { RawClient } from "./set-entry.prisma.js";
import type { RoutineItemRecord, RoutineRecord, RoutineRepository, RoutineWriteFields } from "./routine.js";

/**
 * Prisma-backed RoutineRepository (Spec 09 §6.1). Raw SQL throughout, the
 * 05.0 idiom. Every query is scoped `user_id = $acting` (§7): a foreign id is
 * a 404, never a 403. The name race is decided by `routine_user_name_key`,
 * the cap by a per-user advisory lock (§6.3), the exercise check by one
 * batched query with `findVisibleById`'s predicate (§6.2 step 3).
 */

interface RoutineDbRow {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ItemDbRow {
  id: string;
  routine_id: string;
  position: number;
  exercise_id: string;
  target_sets: number | null;
  target_reps_low: number | null;
  target_reps_high: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  superset_group: number | null;
  notes: string | null;
}

const ROUTINE_COLS = Prisma.sql`id, user_id, name, notes, created_at, updated_at`;
const ITEM_COLS = Prisma.sql`id, routine_id, position, exercise_id, target_sets, target_reps_low,
                             target_reps_high, target_rpe, rest_seconds, superset_group, notes`;

const NOT_FOUND = "routine not found or not owned by the acting user";

function toItem(r: ItemDbRow): RoutineItemRecord {
  return {
    id: r.id,
    routineId: r.routine_id,
    position: r.position,
    exerciseId: r.exercise_id,
    targetSets: r.target_sets,
    targetRepsLow: r.target_reps_low,
    targetRepsHigh: r.target_reps_high,
    targetRpeTenths: r.target_rpe,
    restSeconds: r.rest_seconds,
    supersetGroup: r.superset_group,
    notes: r.notes,
  };
}

function assemble(routines: RoutineDbRow[], items: ItemDbRow[]): RoutineRecord[] {
  const byRoutine = new Map<string, RoutineItemRecord[]>();
  for (const it of items) {
    const list = byRoutine.get(it.routine_id) ?? [];
    list.push(toItem(it));
    byRoutine.set(it.routine_id, list);
  }
  return routines.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: byRoutine.get(r.id) ?? [],
  }));
}

/**
 * §6.2 step 3: resolve every item's exercise in ONE query with the same
 * visibility predicate as `findVisibleById` (`owner_user_id IS NULL OR
 * owner_user_id = $acting`). Missing is reported before retired; the first
 * offending index wins, so the error names one `items.<i>.exerciseId`.
 */
export async function assertItemExercisesUsable(
  tx: RawClient,
  actingUserId: string,
  exerciseIds: string[],
): Promise<void> {
  const unique = [...new Set(exerciseIds)];
  const rows = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`
    SELECT id, is_active FROM "exercise"
    WHERE id = ANY(${unique}::uuid[])
      AND (owner_user_id IS NULL OR owner_user_id = ${actingUserId}::uuid)
  `;
  const active = new Map(rows.map((r) => [r.id, r.is_active]));
  const missing = exerciseIds.findIndex((id) => !active.has(id));
  if (missing >= 0) {
    const fieldErrors: FieldError[] = [
      { path: `items.${missing}.exerciseId`, message: "must reference a visible exercise" },
    ];
    throw new ValidationError(fieldErrors, "routine item references an absent or invisible exercise");
  }
  const retired = exerciseIds.findIndex((id) => active.get(id) === false);
  if (retired >= 0) {
    throw new ExerciseRetiredError(`routine item ${retired} references a retired exercise`, {
      fieldErrors: [{ path: `items.${retired}.exerciseId`, message: "exercise is retired" }],
    });
  }
}

/** §6.2 step 4 + §6.3: normalise groups, convert RPE to tenths (the one
 * write-side conversion, D5), bulk insert with `position` = array index. */
async function insertItems(tx: RawClient, routineId: string, items: RoutineWriteFields["items"]): Promise<void> {
  const groups = normalizeSupersetGroups(items.map((i) => i.supersetGroup ?? null));
  const values = items.map(
    (it, i) => Prisma.sql`(
      ${uuidv7()}::uuid, ${routineId}::uuid, ${i}, ${it.exerciseId}::uuid,
      ${it.targetSets ?? null}, ${it.targetRepsLow ?? null}, ${it.targetRepsHigh ?? null},
      ${it.targetRpe == null ? null : rpeToTenths(it.targetRpe)}, ${it.restSeconds ?? null}, ${groups[i] ?? null},
      ${it.notes ?? null}, now(), now())`,
  );
  await tx.$executeRaw`
    INSERT INTO "routine_item" (${ITEM_COLS}, created_at, updated_at)
    VALUES ${Prisma.join(values)}
  `;
}

async function loadItems(client: RawClient, routineIds: string[]): Promise<ItemDbRow[]> {
  if (routineIds.length === 0) return [];
  return client.$queryRaw<ItemDbRow[]>`
    SELECT ${ITEM_COLS} FROM "routine_item"
    WHERE routine_id = ANY(${routineIds}::uuid[])
    ORDER BY routine_id, position
  `;
}

/** The DETAIL line of a `routine_user_name_key` violation lists the index's
 * key expressions; any other 23505 here is a bug and surfaces as a 500. */
function nameTaken(err: unknown): boolean {
  return isRawUniqueViolation(err) && violatedConstraintColumns(err) === "user_id, lower(name)";
}

export function createRoutineRepository(prisma: PrismaClient): RoutineRepository {
  async function loadOne(client: RawClient, actingUserId: string, id: string): Promise<RoutineRecord> {
    const rows = await client.$queryRaw<RoutineDbRow[]>`
      SELECT ${ROUTINE_COLS} FROM "routine"
      WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
    `;
    const row = rows[0];
    if (!row) throw new NotFoundError(NOT_FOUND);
    return assemble([row], await loadItems(client, [row.id]))[0]!;
  }

  return {
    async list(actingUserId) {
      const rows = await prisma.$queryRaw<RoutineDbRow[]>`
        SELECT ${ROUTINE_COLS} FROM "routine"
        WHERE user_id = ${actingUserId}::uuid
        ORDER BY lower(name), id
      `;
      return assemble(rows, await loadItems(prisma, rows.map((r) => r.id)));
    },

    async getById(actingUserId, id) {
      if (!isRoutineId(id)) throw new NotFoundError(NOT_FOUND);
      return loadOne(prisma, actingUserId, id);
    },

    async create(actingUserId, fields) {
      const id = uuidv7();
      return prisma.$transaction(async (tx) => {
        // The 03.2 cap idiom (insertWithCap): the lock is its own statement so
        // the count's snapshot is taken after the lock is held. The key is
        // prefixed so it never collides with the custom-exercise cap's
        // `hashtext(user_id)`.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"routine:" + actingUserId}))`;
        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "routine" WHERE user_id = ${actingUserId}::uuid
        `;
        if (countRows[0]!.n >= ROUTINES_PER_USER_MAX) throw new RoutineLimitError();
        let row: RoutineDbRow;
        try {
          const rows = await tx.$queryRaw<RoutineDbRow[]>`
            INSERT INTO "routine" (id, user_id, name, notes, created_at, updated_at)
            VALUES (${id}::uuid, ${actingUserId}::uuid, ${fields.name}, ${fields.notes ?? null}, now(), now())
            RETURNING ${ROUTINE_COLS}
          `;
          row = rows[0]!;
        } catch (err) {
          if (nameTaken(err)) throw new RoutineNameTakenError();
          throw err;
        }
        await assertItemExercisesUsable(
          tx,
          actingUserId,
          fields.items.map((i) => i.exerciseId),
        );
        await insertItems(tx, id, fields.items);
        return assemble([row], await loadItems(tx, [id]))[0]!;
      });
    },

    async replace(actingUserId, id, fields) {
      if (!isRoutineId(id)) throw new NotFoundError(NOT_FOUND);
      return prisma.$transaction(async (tx) => {
        // Row lock first: serialises concurrent PUTs on one routine (AC14, D8)
        // and doubles as the 404.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "routine" WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid FOR UPDATE
        `;
        if (!locked[0]) throw new NotFoundError(NOT_FOUND);
        await assertItemExercisesUsable(
          tx,
          actingUserId,
          fields.items.map((i) => i.exerciseId),
        );
        let row: RoutineDbRow;
        try {
          const rows = await tx.$queryRaw<RoutineDbRow[]>`
            UPDATE "routine" SET name = ${fields.name}, notes = ${fields.notes ?? null}, updated_at = now()
            WHERE id = ${id}::uuid
            RETURNING ${ROUTINE_COLS}
          `;
          row = rows[0]!;
        } catch (err) {
          if (nameTaken(err)) throw new RoutineNameTakenError();
          throw err;
        }
        // Delete then reinsert with fresh ids (D2): no transient duplicate
        // position, so `routine_item_routine_position_key` needs no DEFERRABLE.
        await tx.$executeRaw`DELETE FROM "routine_item" WHERE routine_id = ${id}::uuid`;
        await insertItems(tx, id, fields.items);
        return assemble([row], await loadItems(tx, [id]))[0]!;
      });
    },

    async delete(actingUserId, id) {
      if (!isRoutineId(id)) throw new NotFoundError(NOT_FOUND);
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        DELETE FROM "routine" WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid RETURNING id
      `;
      if (!rows[0]) throw new NotFoundError(NOT_FOUND);
    },
  };
}
