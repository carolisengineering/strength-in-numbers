import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_FILES,
  loadCatalog,
  SeedError,
} from "../../src/seed/catalog.js";

/**
 * Spec 03.1 §6.3 / AC4 — the DB-free half of the seed: the Zod input pass and
 * the cross-file reference check. The DB branches are in
 * `test/integration/seed-catalog.integration.test.ts`.
 */

const SHIPPED_DIR = fileURLToPath(new URL("../../prisma/catalog/", import.meta.url));

const muscleGroups = [
  { id: "chest", name: "Chest", displayOrder: 1 },
  { id: "triceps", name: "Triceps", displayOrder: 2 },
];
const equipment = [{ id: "barbell", name: "Barbell", displayOrder: 1 }];
const benchPress = {
  catalogKey: "bench-press",
  name: "Bench press",
  modality: "weight_reps",
  primaryMuscleId: "chest",
  secondaryMuscleIds: ["triceps"],
  equipmentId: "barbell",
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function writeCatalog(files: {
  muscleGroups?: unknown;
  equipment?: unknown;
  exercises?: unknown;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sin-catalog-"));
  dirs.push(dir);
  const contents = {
    [CATALOG_FILES.muscleGroups]: files.muscleGroups ?? muscleGroups,
    [CATALOG_FILES.equipment]: files.equipment ?? equipment,
    [CATALOG_FILES.exercises]: files.exercises ?? [benchPress],
  };
  await Promise.all(
    Object.entries(contents).map(([name, data]) =>
      writeFile(join(dir, name), JSON.stringify(data)),
    ),
  );
  return dir;
}

describe("AC4 — seed input validation (no DB)", () => {
  it("the shipped apps/api/prisma/catalog/ loads cleanly", async () => {
    const catalog = await loadCatalog(SHIPPED_DIR);
    expect(catalog.muscleGroups.length).toBeGreaterThan(0);
    expect(catalog.equipment.length).toBeGreaterThan(0);
    expect(catalog.exercises.length).toBeGreaterThanOrEqual(10);
    expect(catalog.exercises.every((e) => !e.retired)).toBe(true);
  });

  it("applies defaults: secondaryMuscleIds [], equipmentId null, retired false", async () => {
    const dir = await writeCatalog({
      exercises: [
        {
          catalogKey: "plank",
          name: "Plank",
          modality: "duration",
          primaryMuscleId: "chest",
        },
      ],
    });
    const { exercises } = await loadCatalog(dir);
    expect(exercises[0]).toEqual({
      catalogKey: "plank",
      name: "Plank",
      modality: "duration",
      primaryMuscleId: "chest",
      secondaryMuscleIds: [],
      equipmentId: null,
      retired: false,
    });
  });

  it("aborts on an unknown primaryMuscleId, naming the key", async () => {
    const dir = await writeCatalog({
      exercises: [{ ...benchPress, primaryMuscleId: "pecs" }],
    });
    await expect(loadCatalog(dir)).rejects.toMatchObject({
      name: "SeedError",
      catalogKey: "bench-press",
      message: expect.stringContaining('unknown primaryMuscleId "pecs"'),
    });
  });

  it("aborts on an unknown secondaryMuscleId / equipmentId", async () => {
    const bad1 = await writeCatalog({
      exercises: [{ ...benchPress, secondaryMuscleIds: ["forearms"] }],
    });
    await expect(loadCatalog(bad1)).rejects.toThrow(/unknown secondaryMuscleId "forearms"/);

    const bad2 = await writeCatalog({
      exercises: [{ ...benchPress, equipmentId: "smith-machine" }],
    });
    await expect(loadCatalog(bad2)).rejects.toThrow(/unknown equipmentId "smith-machine"/);
  });

  it("aborts on a 200-char name and on a control character (CatalogName refine)", async () => {
    const long = await writeCatalog({
      exercises: [{ ...benchPress, name: "x".repeat(200) }],
    });
    await expect(loadCatalog(long)).rejects.toBeInstanceOf(SeedError);

    const tab = await writeCatalog({
      exercises: [{ ...benchPress, name: "Bench\tpress" }],
    });
    await expect(loadCatalog(tab)).rejects.toThrow(/control characters/);
  });

  it("requires catalogKey / primaryMuscleId / modality (stricter than the table)", async () => {
    for (const missing of ["catalogKey", "primaryMuscleId", "modality"] as const) {
      const entry: Record<string, unknown> = { ...benchPress };
      delete entry[missing];
      const dir = await writeCatalog({ exercises: [entry] });
      await expect(loadCatalog(dir), missing).rejects.toBeInstanceOf(SeedError);
    }
  });

  it("rejects unknown fields, non-kebab keys, and a bad modality", async () => {
    const extra = await writeCatalog({ exercises: [{ ...benchPress, note: "x" }] });
    await expect(loadCatalog(extra)).rejects.toBeInstanceOf(SeedError);

    const key = await writeCatalog({ exercises: [{ ...benchPress, catalogKey: "Bench Press" }] });
    await expect(loadCatalog(key)).rejects.toThrow(/kebab-case/);

    const mod = await writeCatalog({ exercises: [{ ...benchPress, modality: "reps" }] });
    await expect(loadCatalog(mod)).rejects.toBeInstanceOf(SeedError);
  });

  it("rejects duplicate keys / ids within a file", async () => {
    const dir = await writeCatalog({ exercises: [benchPress, benchPress] });
    await expect(loadCatalog(dir)).rejects.toThrow(/duplicate id "bench-press"/);

    const refs = await writeCatalog({ equipment: [...equipment, ...equipment] });
    await expect(loadCatalog(refs)).rejects.toThrow(/duplicate id "barbell"/);
  });

  it("reports a missing file and invalid JSON as SeedError", async () => {
    const dir = await writeCatalog({});
    await rm(join(dir, CATALOG_FILES.equipment));
    await expect(loadCatalog(dir)).rejects.toThrow(/cannot read .*equipment\.json/);

    const broken = await writeCatalog({});
    await writeFile(join(broken, CATALOG_FILES.exercises), "[{");
    await expect(loadCatalog(broken)).rejects.toThrow(/invalid JSON/);
  });
});
