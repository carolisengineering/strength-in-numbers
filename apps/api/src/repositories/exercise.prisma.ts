import type { PrismaClient } from "@prisma/client";
import { isExerciseId } from "@sin/core";
import { NotFoundError } from "../errors/app-error.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
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

  return {
    async findVisibleCatalog(actingUserId: string): Promise<CatalogPage> {
      // `MAX(updated_at) OVER ()` = the newest visible row's timestamp, carried
      // on every row; `LEAST(transaction_timestamp(), …)` clamps it so the
      // cursor can never be emitted ahead of the data. Truncated down to ms.
      const rows = await prisma.$queryRaw<ExerciseDbRowWithCursor[]>`
        SELECT id, catalog_key, owner_user_id, name, modality,
               primary_muscle_id, secondary_muscle_ids, equipment_id,
               is_active, created_at, updated_at,
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
               is_active, created_at, updated_at,
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
      // A non-UUID would make the `::uuid` cast raise 22P02 (→ 500); the
      // contract says "not visible" is a NotFoundError, so treat it as such.
      if (!isExerciseId(id)) {
        throw new NotFoundError(
          "exercise not found or not visible to the acting user",
        );
      }
      const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
        SELECT id, catalog_key, owner_user_id, name, modality,
               primary_muscle_id, secondary_muscle_ids, equipment_id,
               is_active, created_at, updated_at
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
      return toRecord(row);
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
