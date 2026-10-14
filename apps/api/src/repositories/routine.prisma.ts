// apps/api/src/repositories/routine.prisma.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ROUTINES_PER_USER_MAX,
  isRoutineId,
  normalizeSupersetGroups,
  rpeToTenths,
  type Modality,
} from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  ExerciseRetiredError,
  InternalError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import { isRawUniqueViolation, violatedConstraintColumns } from "./pg-errors.js";
import type { RawClient } from "./set-entry.prisma.js";
import type { RoutineItemRecord, RoutineRecord, RoutineRepository, RoutineWriteFields } from "./routine.js";
import {
  assertPlannedSetsFitModalities,
  plannedSetsJson,
  resolveItemPlan,
  toPlannedSet,
  type PlannedSetDbRow,
} from "./planned-sets.js";

/**
 * Prisma-backed RoutineRepository (Spec 09 §6.1). Raw SQL throughout, the
 * 05.0 idiom. Every query is scoped `user_id = $acting` (§7): a foreign id is
 * a 404, never a 403. The name race is decided by `routine_user_name_key`,
 * the cap by a per-user advisory lock (§6.3), the exercise check by one
 * batched query with `findVisibleById`'s predicate (§6.2 step 3).
 */

export interface ItemDbRow {
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
  sets: PlannedSetDbRow[];
  section_id: string | null;
}

export interface SectionDbRow {
  id: string;
  position: number;
  name: string;
  notes: string | null;
}

/** One routine with its items aggregated in the SAME statement (§6.4): a
 * concurrent replace commits atomically, so a read can never see the old
 * header with the new items or vice versa — and the ETag never hashes a
 * document that never existed (code review). */
export interface RoutineDbRow {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  /** `json_agg(json_build_object(…) ORDER BY position)`, `[]` when empty. */
  items: ItemDbRow[];
  /** Spec 09.2 — ordered by position, `[]` when none. */
  sections: SectionDbRow[];
}

const ITEM_COLS = Prisma.sql`id, routine_id, position, exercise_id, target_sets, target_reps_low,
                             target_reps_high, target_rpe, rest_seconds, superset_group, notes, section_id`;
/** The routine header plus its items in one statement; `ORDER BY` and the
 * `WHERE` are the caller's (`${where}` is a bound-parameter fragment). */
const ROUTINE_WITH_ITEMS = (where: Prisma.Sql, orderBy: Prisma.Sql) => Prisma.sql`
  SELECT r.id, r.user_id, r.name, r.notes, r.created_at, r.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', ri.id, 'routine_id', ri.routine_id, 'position', ri.position,
                    'exercise_id', ri.exercise_id, 'target_sets', ri.target_sets,
                    'target_reps_low', ri.target_reps_low, 'target_reps_high', ri.target_reps_high,
                    'target_rpe', ri.target_rpe, 'rest_seconds', ri.rest_seconds,
                    'superset_group', ri.superset_group, 'notes', ri.notes, 'section_id', ri.section_id,
                    'sets', ${plannedSetsJson("routine_item_set", "routine_item_id", "ri.id")})
                  ORDER BY ri.position)
           FROM "routine_item" ri WHERE ri.routine_id = r.id
         ), '[]'::json) AS items,
         COALESCE((
           SELECT json_agg(json_build_object('id', s.id, 'position', s.position, 'name', s.name, 'notes', s.notes)
                           ORDER BY s.position)
           FROM "routine_section" s WHERE s.routine_id = r.id
         ), '[]'::json) AS sections
  FROM "routine" r
  WHERE ${where}
  ${orderBy}
`;

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
    sets: r.sets.map(toPlannedSet),
    sectionId: r.section_id,
  };
}

function toRoutine(r: RoutineDbRow): RoutineRecord {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sections: r.sections.map((s) => ({ id: s.id, position: s.position, name: s.name, notes: s.notes })),
    items: r.items.map(toItem),
  };
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
): Promise<Map<string, Modality>> {
  const unique = [...new Set(exerciseIds)];
  const rows = await tx.$queryRaw<{ id: string; is_active: boolean; modality: string }[]>`
    SELECT id, is_active, modality FROM "exercise"
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
  return new Map(rows.map((r) => [r.id, r.modality as Modality]));
}

/** Spec 09.2 §6.2 — ONE bulk insert of the document's sections (≤ 8 rows); returns request key → new row id. */
async function insertSections(
  tx: RawClient,
  routineId: string,
  sections: NonNullable<RoutineWriteFields["sections"]>,
): Promise<ReadonlyMap<string, string>> {
  const idByKey = new Map<string, string>();
  if (sections.length === 0) return idByKey;
  const values = sections.map((s, j) => {
    const id = uuidv7();
    idByKey.set(s.key, id);
    return Prisma.sql`(${id}::uuid, ${routineId}::uuid, ${j}, ${s.name}, ${s.notes ?? null}, now(), now())`;
  });
  await tx.$executeRaw`
    INSERT INTO "routine_section" (id, routine_id, position, name, notes, created_at, updated_at)
    VALUES ${Prisma.join(values)}
  `;
  return idByKey;
}

/** §6.2 step 4 + §6.3, extended by Spec 09.1 §6.3: rows and derived targets from
 * `resolveItemPlan`; items, then ONE bulk insert of every row. Returns the row count. */
async function insertItems(
  tx: RawClient,
  routineId: string,
  items: RoutineWriteFields["items"],
  sectionIdByKey: ReadonlyMap<string, string>,
): Promise<number> {
  const groups = normalizeSupersetGroups(items.map((i) => i.supersetGroup ?? null));
  const plans = items.map(resolveItemPlan);
  const itemIds = items.map(() => uuidv7());
  const sectionIds = items.map((it) => {
    if (it.sectionKey == null) return null;
    const id = sectionIdByKey.get(it.sectionKey);
    // The request schema rejects an undeclared key (AC6); reaching here is a bug, and throwing rolls the PUT back.
    if (id === undefined) throw new InternalError(`routine item references undeclared section key at insert`);
    return id;
  });
  const values = items.map(
    (it, i) => Prisma.sql`(
      ${itemIds[i]}::uuid, ${routineId}::uuid, ${i}, ${it.exerciseId}::uuid,
      ${plans[i]!.targetSets}, ${plans[i]!.targetRepsLow}, ${plans[i]!.targetRepsHigh},
      ${it.targetRpe == null ? null : rpeToTenths(it.targetRpe)}, ${it.restSeconds ?? null}, ${groups[i] ?? null},
      ${it.notes ?? null}, ${sectionIds[i]}::uuid, now(), now())`,
  );
  await tx.$executeRaw`
    INSERT INTO "routine_item" (${ITEM_COLS}, created_at, updated_at)
    VALUES ${Prisma.join(values)}
  `;
  const rowValues = plans.flatMap((p, i) =>
    p.rows.map(
      (r, j) => Prisma.sql`(
        ${uuidv7()}::uuid, ${itemIds[i]}::uuid, ${j}, ${r.setType}, ${r.repsLow}, ${r.repsHigh},
        ${r.weight}, ${r.weightUnit}, now(), now())`,
    ),
  );
  if (rowValues.length > 0) {
    // ≤ 600 rows × 8 parameters — far under Postgres' 32 767 (§6.3).
    await tx.$executeRaw`
      INSERT INTO "routine_item_set"
        (id, routine_item_id, position, set_type, reps_low, reps_high, weight, weight_unit, created_at, updated_at)
      VALUES ${Prisma.join(rowValues)}
    `;
  }
  return rowValues.length;
}

/** The DETAIL line of a `routine_user_name_key` violation lists the index's
 * key expressions; any other 23505 here is a bug and surfaces as a 500. */
function nameTaken(err: unknown): boolean {
  return isRawUniqueViolation(err) && violatedConstraintColumns(err) === "user_id, lower(name)";
}

export function createRoutineRepository(prisma: PrismaClient): RoutineRepository {
  async function loadOne(client: RawClient, actingUserId: string, id: string): Promise<RoutineRecord> {
    const rows = await client.$queryRaw<RoutineDbRow[]>(
      ROUTINE_WITH_ITEMS(Prisma.sql`r.id = ${id}::uuid AND r.user_id = ${actingUserId}::uuid`, Prisma.empty),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError(NOT_FOUND);
    return toRoutine(row);
  }

  return {
    async list(actingUserId) {
      const rows = await prisma.$queryRaw<RoutineDbRow[]>(
        ROUTINE_WITH_ITEMS(Prisma.sql`r.user_id = ${actingUserId}::uuid`, Prisma.sql`ORDER BY lower(r.name), r.id`),
      );
      return rows.map(toRoutine);
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
        try {
          await tx.$executeRaw`
            INSERT INTO "routine" (id, user_id, name, notes, created_at, updated_at)
            VALUES (${id}::uuid, ${actingUserId}::uuid, ${fields.name}, ${fields.notes ?? null}, now(), now())
          `;
        } catch (err) {
          if (nameTaken(err)) throw new RoutineNameTakenError();
          throw err;
        }
        const modalities = await assertItemExercisesUsable(
          tx,
          actingUserId,
          fields.items.map((i) => i.exerciseId),
        );
        assertPlannedSetsFitModalities(fields.items, modalities);
        const sectionIds = await insertSections(tx, id, fields.sections ?? []);
        await insertItems(tx, id, fields.items, sectionIds);
        return loadOne(tx, actingUserId, id);
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
        const modalities = await assertItemExercisesUsable(
          tx,
          actingUserId,
          fields.items.map((i) => i.exerciseId),
        );
        assertPlannedSetsFitModalities(fields.items, modalities);
        try {
          await tx.$executeRaw`
            UPDATE "routine" SET name = ${fields.name}, notes = ${fields.notes ?? null}, updated_at = now()
            WHERE id = ${id}::uuid
          `;
        } catch (err) {
          if (nameTaken(err)) throw new RoutineNameTakenError();
          throw err;
        }
        // Delete then reinsert with fresh ids (D2): no transient duplicate
        // position, so `routine_item_routine_position_key` needs no DEFERRABLE.
        await tx.$executeRaw`DELETE FROM "routine_item" WHERE routine_id = ${id}::uuid`;
        // Items first, so the SET NULL on routine_item.section_id has nothing to do; deleting before
        // re-inserting is also what lets the section position index stay non-deferrable.
        await tx.$executeRaw`DELETE FROM "routine_section" WHERE routine_id = ${id}::uuid`;
        const sectionIds = await insertSections(tx, id, fields.sections ?? []);
        await insertItems(tx, id, fields.items, sectionIds);
        return loadOne(tx, actingUserId, id);
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

// Spec 11: the account export reuses these.
export { ROUTINE_WITH_ITEMS, toRoutine };
