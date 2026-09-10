import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_FILES,
  loadCatalog,
  seedCatalog,
  type Catalog,
  type SeedLogger,
} from "../../src/seed/catalog.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.1 §6.3 / §10 AC4 — the seed against a real Postgres, always driven
 * through an **explicit catalog-directory arg** pointing at a per-case fixture
 * directory (written under tmp by `writeCatalog`), never the shipped default.
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

/** DTO-projected columns — `updated_at` of reference rows is not in any DTO. */
interface ExerciseRow {
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
interface ReferenceRow {
  id: string;
  name: string;
  display_order: number;
}

describe.skipIf(!shouldRunIntegration())("Catalog seed — integration (AC4)", () => {
  let db: IntegrationDb;
  const dirs: string[] = [];
  let warnings: { obj: Record<string, unknown>; msg: string }[] = [];
  const log: SeedLogger = {
    info: () => {},
    warn: (obj, msg) => warnings.push({ obj, msg }),
  };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    if (!db) return;
    warnings = [];
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "exercise", "muscle_group", "equipment", "user" CASCADE',
    );
  });

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function writeCatalog(files: {
    muscleGroups?: unknown;
    equipment?: unknown;
    exercises?: unknown;
  }): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "sin-seed-"));
    dirs.push(dir);
    const contents = {
      [CATALOG_FILES.muscleGroups]: files.muscleGroups ?? baseMuscles,
      [CATALOG_FILES.equipment]: files.equipment ?? baseEquipment,
      [CATALOG_FILES.exercises]: files.exercises ?? [bench, press],
    };
    await Promise.all(
      Object.entries(contents).map(([name, data]) =>
        writeFile(join(dir, name), JSON.stringify(data)),
      ),
    );
    return dir;
  }

  /** load + seed from an explicit directory, the way the CLI does. */
  async function run(dir: string) {
    const catalog: Catalog = await loadCatalog(dir);
    return seedCatalog(db.prisma, catalog, log);
  }

  const exerciseRows = () =>
    db.prisma.$queryRawUnsafe<ExerciseRow[]>(
      `SELECT "id", "catalog_key", "owner_user_id", "name", "modality",
              "primary_muscle_id", "secondary_muscle_ids", "equipment_id",
              "is_active", "created_at", "updated_at"
       FROM "exercise" ORDER BY "catalog_key"`,
    );
  const referenceRows = (table: "muscle_group" | "equipment") =>
    db.prisma.$queryRawUnsafe<ReferenceRow[]>(
      `SELECT "id", "name", "display_order" FROM "${table}" ORDER BY "id"`,
    );
  const rowFor = async (key: string) =>
    (await exerciseRows()).find((r) => r.catalog_key === key)!;

  it("first run inserts everything and stamps one revision timestamp on every row", async () => {
    const summary = await run(await writeCatalog({}));

    expect(summary).toMatchObject({
      inserted: 2,
      updated: 0,
      retired: 0,
      unchanged: 0,
      skipped: 0,
    });
    const rows = await exerciseRows();
    expect(rows.map((r) => r.catalog_key)).toEqual(["bench-press", "overhead-press"]);
    expect(rows.every((r) => r.owner_user_id === null && r.is_active)).toBe(true);
    const stamps = new Set(rows.map((r) => r.updated_at.toISOString()));
    expect(stamps.size).toBe(1);
    expect(rows[0]!.updated_at.getTime()).toBe(summary.revisionTimestamp.getTime());
    expect(await referenceRows("muscle_group")).toHaveLength(3);
    expect(await referenceRows("equipment")).toHaveLength(2);
  });

  it("is idempotent: a second run yields an identical DTO-projected row set", async () => {
    const dir = await writeCatalog({});
    await run(dir);
    const before = {
      exercises: await exerciseRows(),
      muscles: await referenceRows("muscle_group"),
      equipment: await referenceRows("equipment"),
    };

    const second = await run(dir);

    expect(second).toMatchObject({ inserted: 0, updated: 0, retired: 0, unchanged: 2, skipped: 0 });
    expect(await exerciseRows()).toEqual(before.exercises);
    expect(await referenceRows("muscle_group")).toEqual(before.muscles);
    expect(await referenceRows("equipment")).toEqual(before.equipment);
    expect(warnings).toEqual([]);
  });

  it("unknown primaryMuscleId aborts before touching the DB", async () => {
    const dir = await writeCatalog({
      exercises: [bench, { ...press, primaryMuscleId: "delts" }],
    });
    await expect(run(dir)).rejects.toMatchObject({
      name: "SeedError",
      catalogKey: "overhead-press",
    });
    expect(await exerciseRows()).toEqual([]);
    expect(await referenceRows("muscle_group")).toEqual([]);
  });

  it("a 200-char name or a control character aborts", async () => {
    await expect(
      run(await writeCatalog({ exercises: [{ ...bench, name: "x".repeat(200) }] })),
    ).rejects.toMatchObject({ name: "SeedError" });
    await expect(
      run(await writeCatalog({ exercises: [{ ...bench, name: "Bench\tpress" }] })),
    ).rejects.toMatchObject({ name: "SeedError" });
    expect(await exerciseRows()).toEqual([]);
  });

  it("a changed name on a live key aborts naming the key and rolls back the run", async () => {
    await run(await writeCatalog({}));
    const before = await exerciseRows();

    const dir = await writeCatalog({
      exercises: [
        { ...bench, name: "Barbell bench press" },
        // a would-be insert in the same run must be rolled back too
        { ...press, catalogKey: "push-press", name: "Push press" },
      ],
    });
    await expect(run(dir)).rejects.toMatchObject({
      name: "SeedError",
      catalogKey: "bench-press",
      message: expect.stringContaining("identifying field"),
    });
    expect(await exerciseRows()).toEqual(before);
  });

  it("a changed modality on a live key aborts too", async () => {
    await run(await writeCatalog({}));
    await expect(
      run(await writeCatalog({ exercises: [{ ...bench, modality: "bodyweight_reps" }, press] })),
    ).rejects.toMatchObject({ catalogKey: "bench-press" });
  });

  it("a new entry is exactly one insert; existing rows untouched", async () => {
    await run(await writeCatalog({}));
    const before = await exerciseRows();

    const summary = await run(
      await writeCatalog({
        exercises: [bench, press, { ...press, catalogKey: "push-press", name: "Push press" }],
      }),
    );

    expect(summary).toMatchObject({ inserted: 1, updated: 0, retired: 0, unchanged: 2 });
    const after = await exerciseRows();
    expect(after).toHaveLength(3);
    expect(after.filter((r) => r.catalog_key !== "push-press")).toEqual(before);
  });

  it("a non-identifying change is an UPDATE with updated_at bumped", async () => {
    const first = await run(await writeCatalog({}));
    const summary = await run(
      await writeCatalog({
        exercises: [
          { ...bench, secondaryMuscleIds: ["triceps", "shoulders"], equipmentId: "dumbbell" },
          press,
        ],
      }),
    );

    expect(summary).toMatchObject({ inserted: 0, updated: 1, retired: 0, unchanged: 1 });
    const row = await rowFor("bench-press");
    expect(row.secondary_muscle_ids).toEqual(["triceps", "shoulders"]);
    expect(row.equipment_id).toBe("dumbbell");
    expect(row.name).toBe("Bench press");
    expect(row.is_active).toBe(true);
    expect(row.updated_at.getTime()).toBeGreaterThan(first.revisionTimestamp.getTime());
    expect((await rowFor("overhead-press")).updated_at.getTime()).toBe(
      first.revisionTimestamp.getTime(),
    );
  });

  it("a retired entry sets is_active=false, bumps updated_at, leaves every other column", async () => {
    const first = await run(await writeCatalog({}));
    const before = await rowFor("bench-press");

    const summary = await run(
      await writeCatalog({ exercises: [{ ...bench, retired: true }, press] }),
    );

    expect(summary).toMatchObject({ inserted: 0, updated: 0, retired: 1, unchanged: 1 });
    const after = await rowFor("bench-press");
    expect(after.is_active).toBe(false);
    expect(after.updated_at.getTime()).toBeGreaterThan(first.revisionTimestamp.getTime());
    const stable = ({ is_active, updated_at, ...rest }: ExerciseRow) => {
      void is_active;
      void updated_at;
      return rest;
    };
    expect(stable(after)).toEqual(stable(before));

    // Retiring is idempotent, and un-retiring is refused (03.2's job).
    const again = await run(
      await writeCatalog({ exercises: [{ ...bench, retired: true }, press] }),
    );
    expect(again).toMatchObject({ retired: 0, unchanged: 2 });
    await expect(run(await writeCatalog({}))).rejects.toMatchObject({
      catalogKey: "bench-press",
      message: expect.stringContaining("un-retiring"),
    });
  });

  it("a retired entry that never shipped is skipped with a warning, not inserted", async () => {
    const summary = await run(
      await writeCatalog({ exercises: [bench, { ...press, retired: true }] }),
    );
    expect(summary).toMatchObject({ inserted: 1, skipped: 1 });
    expect((await exerciseRows()).map((r) => r.catalog_key)).toEqual(["bench-press"]);
    expect(warnings.some((w) => w.obj.catalogKey === "overhead-press")).toBe(true);
  });

  it("a DB exercise row absent from the file is left intact with a warning", async () => {
    await run(await writeCatalog({}));
    const before = await rowFor("overhead-press");

    const summary = await run(await writeCatalog({ exercises: [bench] }));

    expect(summary).toMatchObject({ unchanged: 1, skipped: 1 });
    expect(await rowFor("overhead-press")).toEqual(before);
    expect(warnings).toEqual([
      expect.objectContaining({ obj: { catalogKey: "overhead-press" } }),
    ]);
  });

  it("a DB reference row with no file entry is left intact with a warning; display fields update in place", async () => {
    await run(await writeCatalog({}));

    const summary = await run(
      await writeCatalog({
        equipment: [{ id: "barbell", name: "Olympic barbell", displayOrder: 5 }],
        exercises: [bench, press],
      }),
    );

    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await referenceRows("equipment")).toEqual([
      { id: "barbell", name: "Olympic barbell", display_order: 5 },
      { id: "dumbbell", name: "Dumbbell", display_order: 2 },
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({ obj: { table: "equipment", id: "dumbbell" } }),
    ]);
  });

  it("never touches custom (owner-scoped) rows", async () => {
    const userId = "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4c";
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      userId,
      "auth0|seed-test",
      "u@ex.com",
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "catalog_key", "owner_user_id", "name", "modality")
       VALUES ($1::uuid, NULL, $2::uuid, 'My bench', 'weight_reps')`,
      "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4d",
      userId,
    );

    const summary = await run(await writeCatalog({}));

    expect(summary).toMatchObject({ inserted: 2, skipped: 0 });
    const custom = (await exerciseRows()).find((r) => r.owner_user_id === userId)!;
    expect(custom.name).toBe("My bench");
    expect(warnings).toEqual([]);
  });
});
