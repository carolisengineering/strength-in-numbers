import type { PrismaClient } from "@prisma/client";
import { isExerciseId, MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  CustomExerciseLimitError,
  ExerciseAlreadyOwnedError,
  ExerciseImmutableError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  SyncTokenExpiredError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "./exercise-writes.js";
import { formatSyncToken } from "./sync-token.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ExerciseWritePatch,
  ReferenceRecord,
} from "./exercise.js";

/**
 * Prisma-backed ExerciseRepository (Spec 03.1 §6.1).
 *
 * Raw SQL throughout: the visibility filter is a dynamic `OR` that Prisma's
 * query builder cannot AND cleanly onto every path, and `ORDER BY … COLLATE "C"`
 * is not expressible via `orderBy`. `$queryRaw` still parameterises every
 * interpolation (`$1`, `$2`, …); uuid comparands are cast in-query.
 */

interface ExerciseDbRow {
  id: string;
  catalog_key: string | null;
  owner_user_id: string | null;
  name: string;
  modality: string;
  primary_muscle_id: string | null;
  secondary_muscle_ids: string[];
  equipment_id: string | null;
  is_active: boolean;
  forked_from_exercise_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A catalog query row: the token (and, on a delta, `since_is_future`) ride on
 * every row; the LEFT JOIN yields a single all-NULL placeholder row when nothing
 * matches, so the token is still returned for an empty result (Spec 03.3 §6.3).
 */
type CatalogDbRow = { token: string; since_is_future?: boolean } & {
  [K in keyof ExerciseDbRow]: ExerciseDbRow[K] | null;
};
const isDataRow = (r: CatalogDbRow): r is CatalogDbRow & ExerciseDbRow =>
  r.id !== null;

function toRecord(r: ExerciseDbRow): ExerciseRecord {
  return {
    id: r.id,
    catalogKey: r.catalog_key,
    ownerUserId: r.owner_user_id,
    name: r.name,
    modality: r.modality,
    primaryMuscleId: r.primary_muscle_id,
    secondaryMuscleIds: r.secondary_muscle_ids,
    equipmentId: r.equipment_id,
    isActive: r.is_active,
    forkedFromExerciseId: r.forked_from_exercise_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface ReferenceDbRow {
  id: string;
  name: string;
  display_order: number;
}

const toReference = (r: ReferenceDbRow): ReferenceRecord => ({
  id: r.id,
  name: r.name,
  displayOrder: r.display_order,
});

function toCatalogPage(rows: CatalogDbRow[]): CatalogPage {
  const first = rows[0]!; // the `snap` CTE guarantees at least one row
  // Checked before any row is mapped: "no rows changed" and "your token is
  // bogus" are different conditions, and the latter must surface even when the
  // visible row set is empty.
  if (first.since_is_future === true) throw new SyncTokenExpiredError();
  return {
    rows: rows.filter(isDataRow).map(toRecord),
    syncToken: formatSyncToken(first.token),
  };
}

export function createExerciseRepository(
  prisma: PrismaClient,
): ExerciseRepository {
  /** Visibility-filtered row lookup, shared by every write method that needs the
   * existing-row/404 check before branching on ownership/state (spec §6, §7). */
  async function loadVisibleRow(
    actingUserId: string,
    id: string,
  ): Promise<ExerciseDbRow> {
    if (!isExerciseId(id)) {
      throw new NotFoundError(
        "exercise not found or not visible to the acting user",
      );
    }
    const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
      SELECT id, catalog_key, owner_user_id, name, modality,
             primary_muscle_id, secondary_muscle_ids, equipment_id,
             is_active, forked_from_exercise_id, created_at, updated_at
      FROM "exercise"
      WHERE id = ${id}::uuid
        AND (owner_user_id IS NULL OR owner_user_id = ${actingUserId}::uuid)
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError(
        "exercise not found or not visible to the acting user",
      );
    }
    return row;
  }

  /**
   * Batch-checks every reference id in one query per table, collecting *all* bad
   * ones into a single ValidationError rather than stopping at the first (Spec
   * 03.2 §6, AC2). Real FKs on primary_muscle_id/equipment_id stay as
   * defense-in-depth; secondary_muscle_ids has no DB FK at all, so this is its
   * only integrity guard.
   */
  async function validateReferences(fields: ExerciseWriteFields): Promise<void> {
    const muscleIds = [
      ...(fields.primaryMuscleId !== null ? [fields.primaryMuscleId] : []),
      ...fields.secondaryMuscleIds,
    ];
    const uniqueMuscleIds = [...new Set(muscleIds)];
    const equipmentIds = fields.equipmentId !== null ? [fields.equipmentId] : [];

    const [foundMuscle, foundEquipment] = await Promise.all([
      uniqueMuscleIds.length > 0
        ? prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "muscle_group" WHERE id = ANY(${uniqueMuscleIds}::text[])`
        : Promise.resolve([]),
      equipmentIds.length > 0
        ? prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "equipment" WHERE id = ANY(${equipmentIds}::text[])`
        : Promise.resolve([]),
    ]);
    const foundMuscleSet = new Set(foundMuscle.map((r) => r.id));
    const foundEquipmentSet = new Set(foundEquipment.map((r) => r.id));

    const fieldErrors: FieldError[] = [];
    if (fields.primaryMuscleId !== null && !foundMuscleSet.has(fields.primaryMuscleId)) {
      fieldErrors.push({
        path: "primaryMuscleId",
        message: "must reference an existing muscle group",
      });
    }
    if (fields.secondaryMuscleIds.some((id) => !foundMuscleSet.has(id))) {
      fieldErrors.push({
        path: "secondaryMuscleIds",
        message: "must reference existing muscle groups",
      });
    }
    if (fields.equipmentId !== null && !foundEquipmentSet.has(fields.equipmentId)) {
      fieldErrors.push({
        path: "equipmentId",
        message: "must reference an existing equipment id",
      });
    }
    if (fieldErrors.length > 0) {
      throw new ValidationError(
        fieldErrors,
        "create/fork references unknown muscle group or equipment ids",
      );
    }
  }

  /**
   * The atomic, advisory-lock-guarded cap insert (Spec 03.2 §6, D15). Shared
   * verbatim by `createExercise` (forkedFromExerciseId = null) and
   * `forkExercise` (Task 7) — a single budget across both endpoints. Every
   * interpolation is a driver-bound tagged-template parameter, never
   * `$queryRawUnsafe` — `name` is up to 120 chars of verbatim user text on this
   * table's first-ever user-write path (Spec 03.2 §6).
   *
   * Lock acquisition and the count+insert are two *separate* statements inside
   * one `prisma.$transaction`, not one CTE'd statement. In PostgreSQL READ
   * COMMITTED, a statement's MVCC snapshot is fixed at that statement's start,
   * before the executor runs — blocking mid-statement on
   * `pg_advisory_xact_lock` does NOT refresh the snapshot the rest of that same
   * statement sees. A single-statement `WITH _lock AS (SELECT
   * pg_advisory_xact_lock(...)), _cap AS (SELECT count(*) ...)` fixes the
   * count's snapshot at the moment the whole statement started, before the lock
   * was even requested: two concurrent callers can both open with a snapshot
   * showing 499 active rows, one wins the lock and commits (500), and the
   * second — still blocked, then unblocked, but reading the *same pre-commit
   * snapshot it started with* — sees 499, passes the cap check, and inserts a
   * 501st row. Splitting the lock into its own statement means the count
   * statement only *starts* (and only then fixes its snapshot) after
   * `tx.$executeRaw` has returned, i.e. after the lock is confirmed held and
   * any prior holder's transaction has committed or rolled back — so the count
   * this statement sees is always current as of that commit.
   */
  async function insertWithCap(
    actingUserId: string,
    fields: ExerciseWriteFields,
    forkedFromExerciseId: string | null,
  ): Promise<ExerciseDbRow | undefined> {
    const id = uuidv7();
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actingUserId}))`;
      const rows = await tx.$queryRaw<ExerciseDbRow[]>`
        WITH _cap AS (
          SELECT count(*) AS active_count
          FROM "exercise"
          WHERE owner_user_id = ${actingUserId}::uuid AND is_active = true
        )
        INSERT INTO "exercise" (id, owner_user_id, catalog_key, name, modality,
                                primary_muscle_id, secondary_muscle_ids, equipment_id,
                                is_active, forked_from_exercise_id, created_at, updated_at)
        SELECT ${id}::uuid, ${actingUserId}::uuid, NULL, ${fields.name}, ${fields.modality},
               ${fields.primaryMuscleId}, ${fields.secondaryMuscleIds}::text[], ${fields.equipmentId},
               true, ${forkedFromExerciseId}::uuid, now(), now()
        FROM _cap
        WHERE _cap.active_count < ${MAX_CUSTOM_EXERCISES_PER_USER}
        RETURNING id, catalog_key, owner_user_id, name, modality, primary_muscle_id,
                  secondary_muscle_ids, equipment_id, is_active, forked_from_exercise_id,
                  created_at, updated_at
      `;
      return rows[0];
    });
  }

  return {
    async findCatalog(
      actingUserId: string,
      since?: string,
    ): Promise<CatalogPage> {
      // One statement per read (Spec 03.3 §6.2/§6.3): `pg_current_snapshot()` is
      // evaluated against this statement's own snapshot, so the token and the
      // rows describe the same instant — including when the row set is empty.
      // Never add a second query here; a later snapshot would reopen #23.
      const rows =
        since === undefined
          ? await prisma.$queryRaw<CatalogDbRow[]>`
              WITH snap AS (SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS token)
              SELECT snap.token, e.id, e.catalog_key, e.owner_user_id, e.name, e.modality,
                     e.primary_muscle_id, e.secondary_muscle_ids, e.equipment_id,
                     e.is_active, e.forked_from_exercise_id, e.created_at, e.updated_at
              FROM snap
              LEFT JOIN "exercise" e
                ON e.is_active = true
               AND (e.owner_user_id IS NULL OR e.owner_user_id = ${actingUserId}::uuid)
              ORDER BY e.name COLLATE "C", e.id
            `
          : // No `is_active` filter — retired rows must arrive as tombstones.
            await prisma.$queryRaw<CatalogDbRow[]>`
              WITH snap AS (
                SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS token,
                       pg_snapshot_xmax(pg_current_snapshot())      AS xmax
              )
              SELECT snap.token, (${since}::xid8 > snap.xmax) AS since_is_future,
                     e.id, e.catalog_key, e.owner_user_id, e.name, e.modality,
                     e.primary_muscle_id, e.secondary_muscle_ids, e.equipment_id,
                     e.is_active, e.forked_from_exercise_id, e.created_at, e.updated_at
              FROM snap
              LEFT JOIN "exercise" e
                -- ">=": the horizon xid may itself commit after this read
                ON e.change_xid >= ${since}::xid8
               AND (e.owner_user_id IS NULL OR e.owner_user_id = ${actingUserId}::uuid)
              ORDER BY e.name COLLATE "C", e.id
            `;
      return toCatalogPage(rows);
    },

    async findVisibleById(
      actingUserId: string,
      id: string,
    ): Promise<ExerciseRecord> {
      return toRecord(await loadVisibleRow(actingUserId, id));
    },

    async createExercise(
      actingUserId: string,
      fields: ExerciseWriteFields,
    ): Promise<ExerciseRecord> {
      await validateReferences(fields);
      const row = await insertWithCap(actingUserId, fields, null);
      if (!row) throw new CustomExerciseLimitError();
      return toRecord(row);
    },

    async updateExercise(
      actingUserId: string,
      id: string,
      patch: ExerciseWritePatch,
    ): Promise<ExerciseRecord> {
      const before = toRecord(await loadVisibleRow(actingUserId, id));
      if (before.ownerUserId !== actingUserId) throw new ExerciseImmutableUseForkError();
      if (!before.isActive) throw new ExerciseRetiredError();

      const merged = mergeWritableFields(before, patch);
      assertMergedFieldsValid(merged, patch);
      await validateReferences(merged);

      const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
        UPDATE "exercise"
        SET name = ${merged.name}, modality = ${merged.modality},
            primary_muscle_id = ${merged.primaryMuscleId},
            secondary_muscle_ids = ${merged.secondaryMuscleIds}::text[],
            equipment_id = ${merged.equipmentId}, updated_at = now()
        WHERE id = ${id}::uuid AND owner_user_id = ${actingUserId}::uuid AND is_active = true
        RETURNING id, catalog_key, owner_user_id, name, modality, primary_muscle_id,
                  secondary_muscle_ids, equipment_id, is_active, forked_from_exercise_id,
                  created_at, updated_at
      `;
      const updated = rows[0];
      if (!updated) {
        // Lost a race against a concurrent DELETE on the same row (§6 atomicity
        // note) — re-derive the correct 404/409 rather than assume one.
        const recheck = toRecord(await loadVisibleRow(actingUserId, id));
        if (!recheck.isActive) throw new ExerciseRetiredError();
        throw new ExerciseImmutableUseForkError();
      }
      return toRecord(updated);
    },

    async forkExercise(
      actingUserId: string,
      originId: string,
      overlay: ExerciseWritePatch,
    ): Promise<ExerciseRecord> {
      const origin = toRecord(await loadVisibleRow(actingUserId, originId));
      if (origin.ownerUserId === actingUserId) throw new ExerciseAlreadyOwnedError();
      if (!origin.isActive) throw new ExerciseRetiredError();

      const merged = mergeWritableFields(origin, overlay);
      assertMergedFieldsValid(merged, overlay);
      await validateReferences(merged);

      const row = await insertWithCap(actingUserId, merged, origin.id);
      if (!row) throw new CustomExerciseLimitError();
      return toRecord(row);
    },

    async deleteExercise(actingUserId: string, id: string): Promise<void> {
      const target = toRecord(await loadVisibleRow(actingUserId, id));
      if (target.ownerUserId === null) throw new ExerciseImmutableError();
      await prisma.$executeRaw`
        UPDATE "exercise" SET is_active = false, updated_at = now()
        WHERE id = ${id}::uuid AND owner_user_id = ${actingUserId}::uuid AND is_active = true
      `;
    },

    async listMuscleGroups(): Promise<ReferenceRecord[]> {
      const rows = await prisma.$queryRaw<ReferenceDbRow[]>`
        SELECT id, name, display_order
        FROM "muscle_group"
        ORDER BY display_order, id COLLATE "C"
      `;
      return rows.map(toReference);
    },

    async listEquipment(): Promise<ReferenceRecord[]> {
      const rows = await prisma.$queryRaw<ReferenceDbRow[]>`
        SELECT id, name, display_order
        FROM "equipment"
        ORDER BY display_order, id COLLATE "C"
      `;
      return rows.map(toReference);
    },
  };
}
