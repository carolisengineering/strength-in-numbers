import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { importWorkoutFixture, rowCounts, seedPairs } from "./hevy-import-helpers.js";
import { TRUNCATE_ALL } from "./records-helpers.js";

// A translator bug, simulated: the real translation with its first exercise's sets emptied, which the pure re-check
// refuses. Without the re-check in the dry run, the dry run would answer `create` and the real run `rejected`.
const broken = vi.hoisted(() => ({ on: false }));
vi.mock("@sin/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@sin/core")>();
  return {
    ...core,
    translateHevyWorkout: (...args: Parameters<typeof core.translateHevyWorkout>) => {
      const t = core.translateHevyWorkout(...args);
      if (broken.on && t.outcome === "create") t.workout.exercises[0]!.sets = [];
      return t;
    },
  };
});

const U = "0192a1b2-0000-7000-8000-0000000000ab";
const NOW = new Date("2026-10-28T12:00:00Z");

describe.skipIf(!shouldRunIntegration())("Minor 155 — the dry run re-checks the translated body", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    if (!db) return;
    broken.on = false;
    await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
    await insertUser(db, { id: U });
    const bench = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
    await seedPairs(db, U, [{ hevyTemplateId: "T-BENCH", exerciseId: bench }]);
  });

  it("a body the translator got wrong is rejected in the dry run, as in the real run", async () => {
    broken.on = true;
    const repo = createHevyImportRepository(db.prisma);
    const workouts = [importWorkoutFixture({ hevyWorkoutId: "H-BAD" })];
    const before = await rowCounts(db);

    const dry = await repo.importBatch(U, { dryRun: true, workouts }, NOW);
    const real = await repo.importBatch(U, { dryRun: false, workouts }, NOW);

    expect(dry.results.map((r) => r.outcome)).toEqual(["rejected"]);
    expect(real.results.map((r) => r.outcome)).toEqual(["rejected"]);
    expect([dry.setsCreated, real.setsCreated]).toEqual([0, 0]);
    expect(await rowCounts(db)).toEqual(before);
  });

  it("an unbroken body still answers create in both", async () => {
    const repo = createHevyImportRepository(db.prisma);
    const workouts = [importWorkoutFixture({ hevyWorkoutId: "H-OK" })];
    const dry = await repo.importBatch(U, { dryRun: true, workouts }, NOW);
    const real = await repo.importBatch(U, { dryRun: false, workouts }, NOW);
    expect([dry.results[0]!.outcome, real.results[0]!.outcome]).toEqual(["create", "create"]);
  });
});
