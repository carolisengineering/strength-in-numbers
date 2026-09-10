/**
 * Global exercise-catalog seed (Spec 03.1 §6.3, D2 / D8 / D12).
 *
 * Two phases, deliberately separated:
 *
 * 1. `loadCatalog(dir)` — pure: read `muscle-groups.json`, `equipment.json`,
 *    `exercises.json` from `dir`, parse every row against a Zod input schema
 *    that is *stricter* than the tables (`catalogKey` / `primaryMuscleId` /
 *    `modality` required, `name` under the shared `CatalogName` refine), and
 *    cross-check every muscle / equipment reference against the reference rows
 *    in the same load. Any failure throws before the database is touched.
 *
 * 2. `seedCatalog(prisma, catalog, log)` — one transaction, every write stamped
 *    with a single `transaction_timestamp()` so all rows of a revision share one
 *    exact `updated_at` (the split-revision guarantee §6.1 depends on). Reference
 *    rows upsert their display fields in place. `exercise` rows are keyed by
 *    `catalog_key` and handled by explicit read-then-branch — **not** an
 *    `ON CONFLICT (catalog_key)` upsert: the branch logic (abort on an
 *    identifying change) can't be an upsert, and the unique index is partial
 *    (`WHERE owner_user_id IS NULL`), so a plain conflict target would fail.
 *
 * The seed is append-only: it adds and retires, never deletes, never renames a
 * live row, and never un-retires (that is 03.2's mistake-correction path).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CatalogName, MODALITY_VALUES } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schemas (stricter than the tables — §6.3)
// ---------------------------------------------------------------------------

/** Natural reference code / catalog key: lowercase kebab, e.g. `lats`, `pull-up`. */
const Code = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase kebab-case");

export const ReferenceInput = z
  .object({
    id: Code,
    name: CatalogName,
    displayOrder: z.int().min(0).max(32767),
  })
  .strict();
export type ReferenceInput = z.infer<typeof ReferenceInput>;

export const ExerciseInput = z
  .object({
    catalogKey: Code,
    name: CatalogName,
    modality: z.enum(MODALITY_VALUES),
    primaryMuscleId: Code,
    secondaryMuscleIds: z.array(Code).default([]),
    equipmentId: Code.nullable().default(null),
    retired: z.boolean().default(false),
  })
  .strict();
export type ExerciseInput = z.infer<typeof ExerciseInput>;

export interface Catalog {
  muscleGroups: ReferenceInput[];
  equipment: ReferenceInput[];
  exercises: ExerciseInput[];
}

/** Thrown by both phases; `catalogKey` is set when one row is to blame. */
export class SeedError extends Error {
  constructor(
    message: string,
    readonly catalogKey?: string,
  ) {
    super(message);
    this.name = "SeedError";
  }
}

export const CATALOG_FILES = {
  muscleGroups: "muscle-groups.json",
  equipment: "equipment.json",
  exercises: "exercises.json",
} as const;

// ---------------------------------------------------------------------------
// Phase 1 — load + validate (no DB)
// ---------------------------------------------------------------------------

async function readJsonArray<T>(
  dir: string,
  file: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const path = join(dir, file);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new SeedError(`cannot read ${path}: ${(cause as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new SeedError(`${file}: invalid JSON — ${(cause as Error).message}`);
  }
  const result = z.array(schema).safeParse(json);
  if (!result.success) {
    throw new SeedError(`${file}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function assertUniqueIds(file: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SeedError(`${file}: duplicate id "${id}"`, id);
    seen.add(id);
  }
}

export async function loadCatalog(dir: string): Promise<Catalog> {
  const [muscleGroups, equipment, exercises] = await Promise.all([
    readJsonArray(dir, CATALOG_FILES.muscleGroups, ReferenceInput),
    readJsonArray(dir, CATALOG_FILES.equipment, ReferenceInput),
    readJsonArray(dir, CATALOG_FILES.exercises, ExerciseInput),
  ]);

  assertUniqueIds(CATALOG_FILES.muscleGroups, muscleGroups.map((m) => m.id));
  assertUniqueIds(CATALOG_FILES.equipment, equipment.map((e) => e.id));
  assertUniqueIds(CATALOG_FILES.exercises, exercises.map((e) => e.catalogKey));

  const muscleIds = new Set(muscleGroups.map((m) => m.id));
  const equipmentIds = new Set(equipment.map((e) => e.id));

  for (const ex of exercises) {
    const key = ex.catalogKey;
    if (!muscleIds.has(ex.primaryMuscleId)) {
      throw new SeedError(
        `${CATALOG_FILES.exercises}: "${key}" references unknown primaryMuscleId "${ex.primaryMuscleId}"`,
        key,
      );
    }
    for (const id of ex.secondaryMuscleIds) {
      if (!muscleIds.has(id)) {
        throw new SeedError(
          `${CATALOG_FILES.exercises}: "${key}" references unknown secondaryMuscleId "${id}"`,
          key,
        );
      }
    }
    if (ex.equipmentId !== null && !equipmentIds.has(ex.equipmentId)) {
      throw new SeedError(
        `${CATALOG_FILES.exercises}: "${key}" references unknown equipmentId "${ex.equipmentId}"`,
        key,
      );
    }
  }

  return { muscleGroups, equipment, exercises };
}

// ---------------------------------------------------------------------------
// Phase 2 — one transaction
// ---------------------------------------------------------------------------

export interface SeedLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

/** Spec 03.1 §9 "seed run summary". */
export interface SeedSummary {
  inserted: number;
  updated: number;
  retired: number;
  unchanged: number;
  /** DB rows absent from the file, or `retired` entries that never shipped. */
  skipped: number;
  revisionTimestamp: Date;
}

interface GlobalExerciseRow {
  id: string;
  catalog_key: string;
  name: string;
  modality: string;
  primary_muscle_id: string | null;
  secondary_muscle_ids: string[];
  equipment_id: string | null;
  is_active: boolean;
}

const sameArray = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The Prisma client type inside `$transaction` (no `$transaction` on it). */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function upsertReference(
  tx: Tx,
  table: "muscle_group" | "equipment",
  file: string,
  rows: ReferenceInput[],
  ts: Date,
  log: SeedLogger,
): Promise<void> {
  // `table` is a closed literal union; `Prisma.raw` inlines it as an
  // identifier while every value below stays a bound parameter.
  const tableId = Prisma.raw(`"${table}"`);
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${tableId}`;
  const inFile = new Set(rows.map((r) => r.id));
  for (const { id } of existing) {
    if (!inFile.has(id)) {
      // Codes are immutable once shipped (D3): never delete, just say so.
      log.warn(
        { table, id },
        `${table} row "${id}" has no entry in ${file}; left in place`,
      );
    }
  }
  for (const r of rows) {
    await tx.$executeRaw`
      INSERT INTO ${tableId} ("id", "name", "display_order", "created_at", "updated_at")
      VALUES (${r.id}, ${r.name}, ${r.displayOrder}, ${ts}, ${ts})
      ON CONFLICT ("id") DO UPDATE
        SET "name" = EXCLUDED."name",
            "display_order" = EXCLUDED."display_order",
            "updated_at" = EXCLUDED."updated_at"`;
  }
}

export async function seedCatalog(
  prisma: PrismaClient,
  catalog: Catalog,
  log: SeedLogger,
): Promise<SeedSummary> {
  return prisma.$transaction(
    async (tx) => {
      // One clock value for the whole revision (§6.1 split-revision guarantee).
      const [{ ts }] = await tx.$queryRaw<[{ ts: Date }]>`
        SELECT transaction_timestamp() AS ts`;

      await upsertReference(
        tx,
        "muscle_group",
        CATALOG_FILES.muscleGroups,
        catalog.muscleGroups,
        ts,
        log,
      );
      await upsertReference(
        tx,
        "equipment",
        CATALOG_FILES.equipment,
        catalog.equipment,
        ts,
        log,
      );

      const dbRows = await tx.$queryRaw<GlobalExerciseRow[]>`
        SELECT "id", "catalog_key", "name", "modality", "primary_muscle_id",
               "secondary_muscle_ids", "equipment_id", "is_active"
        FROM "exercise"
        WHERE "owner_user_id" IS NULL AND "catalog_key" IS NOT NULL`;
      const byKey = new Map(dbRows.map((r) => [r.catalog_key, r]));

      const summary: SeedSummary = {
        inserted: 0,
        updated: 0,
        retired: 0,
        unchanged: 0,
        skipped: 0,
        revisionTimestamp: ts,
      };

      for (const ex of catalog.exercises) {
        const key = ex.catalogKey;
        const row = byKey.get(key);

        if (!row) {
          if (ex.retired) {
            log.warn(
              { catalogKey: key },
              `"${key}" is marked retired but was never seeded; skipped`,
            );
            summary.skipped += 1;
            continue;
          }
          await tx.$executeRaw`
            INSERT INTO "exercise"
              ("id", "catalog_key", "owner_user_id", "name", "modality",
               "primary_muscle_id", "secondary_muscle_ids", "equipment_id",
               "is_active", "created_at", "updated_at")
            VALUES
              (${uuidv7()}::uuid, ${key}, NULL, ${ex.name}, ${ex.modality},
               ${ex.primaryMuscleId}, ${ex.secondaryMuscleIds}::text[],
               ${ex.equipmentId}, true, ${ts}, ${ts})`;
          summary.inserted += 1;
          continue;
        }

        if (ex.retired) {
          if (!row.is_active) {
            summary.unchanged += 1;
            continue;
          }
          await tx.$executeRaw`
            UPDATE "exercise" SET "is_active" = false, "updated_at" = ${ts}
            WHERE "id" = ${row.id}::uuid`;
          summary.retired += 1;
          continue;
        }

        if (!row.is_active) {
          throw new SeedError(
            `"${key}" is retired in the database but not marked retired in the file; un-retiring is not a seed operation (Spec 03.1 §6.3)`,
            key,
          );
        }

        if (row.name !== ex.name || row.modality !== ex.modality) {
          throw new SeedError(
            `"${key}" changed an identifying field (name/modality) on a live row; retire the old key and add a new one instead (append-only, DESIGN §4.2)`,
            key,
          );
        }

        const changed =
          row.primary_muscle_id !== ex.primaryMuscleId ||
          row.equipment_id !== ex.equipmentId ||
          !sameArray(row.secondary_muscle_ids, ex.secondaryMuscleIds);
        if (!changed) {
          summary.unchanged += 1;
          continue;
        }
        await tx.$executeRaw`
          UPDATE "exercise"
          SET "primary_muscle_id" = ${ex.primaryMuscleId},
              "secondary_muscle_ids" = ${ex.secondaryMuscleIds}::text[],
              "equipment_id" = ${ex.equipmentId},
              "updated_at" = ${ts}
          WHERE "id" = ${row.id}::uuid`;
        summary.updated += 1;
      }

      const inFile = new Set(catalog.exercises.map((e) => e.catalogKey));
      for (const row of dbRows) {
        if (!inFile.has(row.catalog_key)) {
          log.warn(
            { catalogKey: row.catalog_key },
            `"${row.catalog_key}" exists in the database but not in ${CATALOG_FILES.exercises}; left as-is (mark it retired rather than dropping it)`,
          );
          summary.skipped += 1;
        }
      }

      return summary;
    },
    { timeout: 60_000 },
  );
}
