import type { PrismaClient } from "@prisma/client";
import { isExerciseId, MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
import { uuidv7 } from "uuidv7";
import {
  CustomExerciseLimitError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "./exercise-writes.js";
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

/** A catalog row query also carries the derived `serverTime` on every row. */
type ExerciseDbRowWithCursor = ExerciseDbRow & { server_time: Date };

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

export function createExerciseRepository(
  prisma: PrismaClient,
): ExerciseRepository {
  /** ms-truncated `transaction_timestamp()` — the empty-visible-set fallback. */
  async function serverNow(): Promise<Date> {
    const [row] = await prisma.$queryRaw<{ server_time: Date }[]>`
      SELECT date_trunc('milliseconds', transaction_timestamp()) AS server_time
    `;
    return row!.server_time;
  }

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
   */
  async function insertWithCap(
    actingUserId: string,
    fields: ExerciseWriteFields,
    forkedFromExerciseId: string | null,
  ): Promise<ExerciseDbRow | undefined> {
    const id = uuidv7();
    const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
      WITH _lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${actingUserId}))
      ),
      _cap AS (
        SELECT count(*) AS active_count
        FROM "exercise", _lock
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
  }

  return {
    async findVisibleCatalog(actingUserId: string): Promise<CatalogPage> {
      // `MAX(updated_at) OVER ()` = the newest visible row's timestamp, carried
      // on every row; `LEAST(transaction_timestamp(), …)` clamps it so the
      // cursor can never be emitted ahead of the data. Truncated down to ms.
      const rows = await prisma.$queryRaw<ExerciseDbRowWithCursor[]>`
        SELECT id, catalog_key, owner_user_id, name, modality,
               primary_muscle_id, secondary_muscle_ids, equipment_id,
               is_active, forked_from_exercise_id, created_at, updated_at,
               date_trunc(
                 'milliseconds',
                 LEAST(transaction_timestamp(), MAX(updated_at) OVER ())
               ) AS server_time
        FROM "exercise"
        WHERE is_active = true
          AND (owner_user_id IS NULL OR owner_user_id = ${actingUserId}::uuid)
        ORDER BY name COLLATE "C", id
      `;
      const first = rows[0];
      return {
        rows: rows.map(toRecord),
        serverTime: first ? first.server_time : await serverNow(),
      };
    },

    async findCatalogDelta(
      actingUserId: string,
      sinceIso: string,
    ): Promise<CatalogPage> {
      // No `is_active` filter — retired rows must arrive as tombstones. The
      // cursor comes from what this query already scanned: GREATEST(:since,
      // MAX over the returned rows), clamped to server-now, truncated to ms.
      const rows = await prisma.$queryRaw<ExerciseDbRowWithCursor[]>`
        SELECT id, catalog_key, owner_user_id, name, modality,
               primary_muscle_id, secondary_muscle_ids, equipment_id,
               is_active, forked_from_exercise_id, created_at, updated_at,
               date_trunc(
                 'milliseconds',
                 LEAST(
                   transaction_timestamp(),
                   GREATEST(${sinceIso}::timestamptz, MAX(updated_at) OVER ())
                 )
               ) AS server_time
        FROM "exercise"
        WHERE updated_at > ${sinceIso}::timestamptz
          AND (owner_user_id IS NULL OR owner_user_id = ${actingUserId}::uuid)
        ORDER BY name COLLATE "C", id
      `;
      const first = rows[0];
      if (first) {
        return { rows: rows.map(toRecord), serverTime: first.server_time };
      }
      // Empty delta: echo the cursor, clamped so a future/crafted value heals.
      const [clamp] = await prisma.$queryRaw<{ server_time: Date }[]>`
        SELECT date_trunc(
                 'milliseconds',
                 LEAST(transaction_timestamp(), ${sinceIso}::timestamptz)
               ) AS server_time
      `;
      return { rows: [], serverTime: clamp!.server_time };
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
      assertMergedFieldsValid(merged);

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
