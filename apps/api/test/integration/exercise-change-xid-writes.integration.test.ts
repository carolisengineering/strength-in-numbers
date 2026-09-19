import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import {
  CATALOG_FILES,
  loadCatalog,
  seedCatalog,
  type SeedLogger,
} from "../../src/seed/catalog.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.3 §10 AC2 — every write path stamps `change_xid` through the trigger,
 * with no change to those statements' column lists. `xid8` cannot be deserialized
 * by `$queryRaw`, so every read here selects `change_xid::text`.
 */

const baseMuscles = [
  { id: "chest", name: "Chest", displayOrder: 1 },
  { id: "triceps", name: "Triceps", displayOrder: 2 },
  { id: "shoulders", name: "Shoulders", displayOrder: 3 },
];
const baseEquipment = [
  { id: "barbell", name: "Barbell", displayOrder: 1 },
  { id: "dumbbell", name: "Dumbbell", displayOrder: 2 },
];
const bench = {
  catalogKey: "bench-press",
  name: "Bench press",
  modality: "weight_reps",
  primaryMuscleId: "chest",
  secondaryMuscleIds: ["triceps"],
  equipmentId: "barbell",
};
const press = {
  catalogKey: "overhead-press",
  name: "Overhead press",
  modality: "weight_reps",
  primaryMuscleId: "shoulders",
  secondaryMuscleIds: ["triceps"],
  equipmentId: "barbell",
};

const FIELDS = {
  name: "Mine",
  modality: "weight_reps",
  primaryMuscleId: null,
  secondaryMuscleIds: [],
  equipmentId: null,
};

describe.skipIf(!shouldRunIntegration())(
  "AC2 — every write path stamps change_xid via the trigger (integration, real Postgres)",
  () => {
    let db: IntegrationDb;
    let repo: ExerciseRepository;
    const dirs: string[] = [];
    const log: SeedLogger = { info: () => {}, warn: () => {} };

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
      repo = createExerciseRepository(db.prisma);
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    beforeEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe(
        'TRUNCATE "exercise", "muscle_group", "equipment", "user" CASCADE',
      );
    });

    afterEach(async () => {
      await Promise.all(
        dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
      );
    });

    const xidOf = async (id: string): Promise<bigint> =>
      BigInt(
        (
          await db.prisma.$queryRawUnsafe<{ x: string }[]>(
            `SELECT change_xid::text AS x FROM "exercise" WHERE id = $1::uuid`,
            id,
          )
        )[0]!.x,
      );

    /** The oldest in-flight xid right now — every write after this must stamp >= it. */
    const horizon = async (): Promise<bigint> =>
      BigInt(
        (
          await db.prisma.$queryRaw<{ h: string }[]>`
            SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS h`
        )[0]!.h,
      );

    async function insertUser(id: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
    }

    it("createExercise / updateExercise / forkExercise / deleteExercise each stamp change_xid >= the horizon sampled just before", async () => {
      const u = uuidv7();
      await insertUser(u);
      const globalId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","catalog_key","name","modality")
         VALUES ($1::uuid, 'global-one', 'Global', 'weight_reps')`,
        globalId,
      );

      let h = await horizon();
      const created = await repo.createExercise(u, FIELDS);
      expect(await xidOf(created.id)).toBeGreaterThanOrEqual(h);

      h = await horizon();
      const before = await xidOf(created.id);
      await repo.updateExercise(u, created.id, { name: "Renamed" });
      expect(await xidOf(created.id)).toBeGreaterThanOrEqual(h);
      expect(await xidOf(created.id)).toBeGreaterThan(before); // re-stamped

      h = await horizon();
      const forked = await repo.forkExercise(u, globalId, {});
      expect(await xidOf(forked.id)).toBeGreaterThanOrEqual(h);

      h = await horizon();
      await repo.deleteExercise(u, created.id); // soft-delete is an UPDATE
      expect(await xidOf(created.id)).toBeGreaterThanOrEqual(h);

      const nulls = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "exercise" WHERE change_xid IS NULL`,
      );
      expect(nulls[0]!.n).toBe(0);
    });

    async function writeCatalog(exercises: unknown): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), "sin-seed-"));
      dirs.push(dir);
      const contents = {
        [CATALOG_FILES.muscleGroups]: baseMuscles,
        [CATALOG_FILES.equipment]: baseEquipment,
        [CATALOG_FILES.exercises]: exercises,
      };
      await Promise.all(
        Object.entries(contents).map(([name, data]) =>
          writeFile(join(dir, name), JSON.stringify(data)),
        ),
      );
      return dir;
    }

    const run = async (dir: string) =>
      seedCatalog(db.prisma, await loadCatalog(dir), log);

    it("every seed write branch (insert, non-identifying update, retire) is stamped, and one revision shares ONE change_xid", async () => {
      await run(await writeCatalog([bench, press])); // revision 1
      const h = await horizon();

      const summary = await run(
        await writeCatalog([
          { ...bench, equipmentId: "dumbbell" }, // non-identifying update
          { ...press, catalogKey: "push-press", name: "Push press" }, // insert
          { ...press, retired: true }, // retire
        ]),
      );
      expect(summary).toMatchObject({ inserted: 1, updated: 1, retired: 1 });

      const rows = await db.prisma.$queryRawUnsafe<{ x: string }[]>(
        `SELECT change_xid::text AS x FROM "exercise"
         WHERE catalog_key IN ('bench-press','overhead-press','push-press')`,
      );
      const xids = rows.map((r) => BigInt(r.x));
      expect(xids).toHaveLength(3); // all three rows were written by revision 2
      expect(new Set(xids.map(String)).size).toBe(1); // one transaction → one xid
      expect(xids[0]!).toBeGreaterThanOrEqual(h);
    });
  },
);
