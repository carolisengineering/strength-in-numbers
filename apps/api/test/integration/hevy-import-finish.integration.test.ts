import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HevyImportWorkout } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { importWorkoutFixture, rowCounts, seedPairs } from "./hevy-import-helpers.js";
import { logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow } from "./records-helpers.js";

const U = "0192a1b2-0000-7000-8000-0000000000aa";
const AUTH = { authorization: "Bearer a" };
const NOW = new Date("2026-10-28T12:00:00Z");
const silent = pino({ level: "silent" });
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id,
    record_type,
    value,
    previous_value,
    source_set_entry_id,
    workout_id,
  }));

/** Three Hevy sessions of bench, heavier each time, on separate days. */
const history = (): HevyImportWorkout[] =>
  [60, 65, 70].map((kg, i) =>
    importWorkoutFixture({
      hevyWorkoutId: `H-${i}`,
      startTime: `2026-09-0${i + 1}T10:00:00Z`,
      endTime: `2026-09-0${i + 1}T11:00:00Z`,
      exercises: [
        {
          exerciseTemplateId: "T-BENCH",
          notes: null,
          supersetId: null,
          sets: [{ type: "normal", weightKg: kg, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
        },
      ],
    }),
  );

/** Spec 19.1 §6.5 — the import finish. */
describe.skipIf(!shouldRunIntegration())("Spec 19.1 — Hevy import finish (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  let bench: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await buildApp({
      config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set([U])) },
      logger: silent,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: `auth0|${U}` })),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: workouts(),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
      hevyRepository: createHevyRepository(db.prisma),
      hevyImportRepository: createHevyImportRepository(db.prisma),
      rateLimits: GENEROUS_LIMITS,
    });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  beforeEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
    await insertUser(db, { id: U });
    bench = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
    await seedPairs(db, U, [{ hevyTemplateId: "T-BENCH", exerciseId: bench }]);
  });

  function workouts() {
    return createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  }
  const repo = () => createHevyImportRepository(db.prisma);
  const importHistory = () => repo().importBatch(U, { dryRun: false, workouts: history() }, NOW);
  const stale = async () =>
    (await db.prisma.$queryRawUnsafe<{ records_stale: boolean }[]>(`SELECT records_stale FROM hevy_account WHERE user_id = $1::uuid`, U))[0]
      ?.records_stale ?? null;
  /** What a full `records:rebuild --user` writes over the same data. */
  async function fullRebuild() {
    const mine = shape(await recordsOf(db, U));
    await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
    await rebuildRecords(db.prisma, silent, { userId: U });
    const expected = shape(await recordsOf(db, U));
    return { mine, expected };
  }

  describe("19.1 AC26 — finish", () => {
    it("with no hevy_account row, answers not recomputed and inserts none", async () => {
      await expect(repo().finishImport(U)).resolves.toEqual({ recomputed: false, rootCount: 0 });
      expect(await stale()).toBeNull();
    });

    it("with the flag false, answers not recomputed", async () => {
      await db.prisma.$executeRawUnsafe(`INSERT INTO hevy_account (user_id, records_stale) VALUES ($1::uuid, false)`, U);
      await expect(repo().finishImport(U)).resolves.toEqual({ recomputed: false, rootCount: 0 });
    });

    it("after a batch, rebuilds exactly as records:rebuild, clears the flag, and a second call is a no-op", async () => {
      await importHistory();
      expect(await stale()).toBe(true);
      expect(await recordsOf(db, U)).toEqual([]);

      await expect(repo().finishImport(U)).resolves.toEqual({ recomputed: true, rootCount: 1 });
      expect(await stale()).toBe(false);
      await expect(repo().finishImport(U)).resolves.toEqual({ recomputed: false, rootCount: 0 });

      const { mine, expected } = await fullRebuild();
      expect(mine.length).toBeGreaterThan(0);
      expect(mine).toEqual(expected);
    });

    it("History's recordCount and GET /v1/personal-records reflect the imported workouts", async () => {
      await importHistory();
      await repo().finishImport(U);
      const prs = await app.inject({ method: "GET", url: "/v1/personal-records", headers: AUTH });
      expect((prs.json() as { records: unknown[] }).records.length).toBeGreaterThan(0);
      const list = await app.inject({ method: "GET", url: "/v1/workouts", headers: AUTH });
      const items = (list.json() as { items: { recordCount: number }[] }).items;
      expect(items.reduce((n, i) => n + i.recordCount, 0)).toBeGreaterThan(0);
    });
  });

  describe("19.1 AC27 — lock order and concurrency", () => {
    it("a finish and a live workout's finish at the same time end serially, with records equal to a full rebuild", async () => {
      await importHistory();
      const { workoutId: live } = await logWorkout(db, U, {
        startedAt: new Date("2026-10-28T10:00:00Z"),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 80 }] }],
      });
      await Promise.all([repo().finishImport(U), workouts().updateWorkout(U, live, { endedAt: "2026-10-28T11:00:00Z" })]);
      const { mine, expected } = await fullRebuild();
      expect(mine).toEqual(expected);
    });

    it("two batches and a finish at once complete", async () => {
      const [a, b] = [history().slice(0, 2), history().slice(2)];
      await expect(
        Promise.all([
          repo().importBatch(U, { dryRun: false, workouts: a }, NOW),
          repo().importBatch(U, { dryRun: false, workouts: b }, NOW),
          repo().finishImport(U),
        ]),
      ).resolves.toHaveLength(3);
      await repo().finishImport(U);
      const { mine, expected } = await fullRebuild();
      expect(mine).toEqual(expected);
    });
  });

  describe("19.1 AC28 — a live workout is untouched", () => {
    it("batches succeed beside it, it is unchanged, and finishing it sees the imported lineage", async () => {
      const { workoutId: live } = await logWorkout(db, U, {
        startedAt: new Date("2026-10-28T10:00:00Z"),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 50 }] }],
      });
      const snapshot = () =>
        db.prisma.$queryRawUnsafe(
          `SELECT w.ended_at, w.updated_at, s.id::text, s.weight::text, s.updated_at AS su FROM workout w
           JOIN workout_exercise we ON we.workout_id = w.id JOIN set_entry s ON s.workout_exercise_id = we.id WHERE w.id = $1::uuid`,
          live,
        );
      const before = await snapshot();
      const out = await importHistory();
      expect(out.results.map((r) => r.outcome)).toEqual(["create", "create", "create"]);
      expect(await snapshot()).toEqual(before);
      expect((await rowCounts(db)).workout).toBe(4);

      await workouts().updateWorkout(U, live, { endedAt: "2026-10-28T11:00:00Z" });
      const { mine, expected } = await fullRebuild();
      expect(mine).toEqual(expected);
    });
  });
});
