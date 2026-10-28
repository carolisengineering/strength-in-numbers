import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HevyImportWorkout } from "@sin/core";
import { runPurge } from "../../src/account/purge.js";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
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
import { seedPairs } from "./hevy-import-helpers.js";
import { logWorkout, recordsOf, TRUNCATE_ALL, type ExerciseSpec, type RecordRow } from "./records-helpers.js";

const A_ID = "0192a1b2-0000-7000-8000-0000000000aa";
const B_ID = "0192a1b2-0000-7000-8000-0000000000bb";
const AS_A = { authorization: "Bearer a" };
const AS_B = { authorization: "Bearer b" };
const silent = pino({ level: "silent" });
const HISTORY = (JSON.parse(readFileSync(new URL("../fixtures/hevy/import-history.json", import.meta.url), "utf8")) as { workouts: HevyImportWorkout[] })
  .workouts;

/** A record without the ids that differ between two users' rows. */
const comparable = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, unit, previous_value }) => ({ exercise_id, record_type, value, unit, previous_value }));

/** Spec 19.1 AC30, AC31, AC34 — the import end to end, through the routes. */
describe.skipIf(!shouldRunIntegration())("Spec 19.1 — Hevy import end to end (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  let ids: { bench: string; row: string; carry: string };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await buildApp({
      config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set([A_ID])) },
      logger: silent,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => authContext({ authSub: `auth0|${token === "a" ? A_ID : B_ID}` })),
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
    await insertUser(db, { id: A_ID });
    await insertUser(db, { id: B_ID });
    ids = {
      bench: await insertExercise(db, { name: "Bench Press", modality: "weight_reps" }),
      row: await insertExercise(db, { name: "Row Erg", modality: "calories" }),
      carry: await insertExercise(db, { name: "Farmer Carry", modality: "weight_distance" }),
    };
    await seedPairs(db, A_ID, [
      { hevyTemplateId: "T-BENCH", exerciseId: ids.bench },
      { hevyTemplateId: "T-ROW", exerciseId: ids.row, hevyType: "reps_only", measureRule: "calories_as_reps" },
      { hevyTemplateId: "T-CARRY", exerciseId: ids.carry, hevyType: "short_distance_weight" },
    ]);
  });

  function workouts() {
    return createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  }

  async function importAll(): Promise<void> {
    for (let i = 0; i < HISTORY.length; i += 5) {
      const res = await app.inject({ method: "POST", url: "/v1/hevy/import/workouts", headers: AS_A, payload: { dryRun: false, workouts: HISTORY.slice(i, i + 5) } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { results: { outcome: string }[] }).results.every((r) => r.outcome === "create")).toBe(true);
    }
    const finish = await app.inject({ method: "POST", url: "/v1/hevy/import/finish", headers: AS_A });
    expect(finish.json()).toEqual({ recomputed: true, rootCount: 3 });
  }

  /** The same sets, logged as an ordinary user and finished one workout at a time through the live path. */
  async function logAsB(): Promise<void> {
    for (const w of HISTORY) {
      const exercises: ExerciseSpec[] = w.exercises.map((e) => {
        if (e.exerciseTemplateId === "T-BENCH") {
          return {
            exerciseId: ids.bench,
            sets: e.sets.map((s) => ({ setType: s.type === "warmup" ? "warmup" : "working", weight: s.weightKg, reps: s.reps })),
          };
        }
        if (e.exerciseTemplateId === "T-ROW") {
          return { exerciseId: ids.row, modality: "calories", sets: e.sets.map((s) => ({ calories: s.reps })) };
        }
        return {
          exerciseId: ids.carry,
          modality: "weight_distance",
          sets: e.sets.map((s) => ({ weight: s.weightKg, distance: s.distanceMeters, distanceUnit: "m" as const })),
        };
      });
      const { workoutId } = await logWorkout(db, B_ID, { startedAt: new Date(w.startTime), finish: "none", exercises });
      await workouts().updateWorkout(B_ID, workoutId, { endedAt: w.endTime });
    }
  }

  async function series(headers: Record<string, string>, exerciseId: string) {
    const res = await app.inject({ method: "GET", url: `/v1/progress/exercises/${exerciseId}`, headers });
    expect(res.statusCode).toBe(200);
    return (res.json() as { points: Record<string, unknown>[] }).points.map((p) => ({ ...p, workoutId: null }));
  }

  describe("19.1 AC30 — records agree end to end", () => {
    it("imported history plus finish equals the same sets logged and finished as usual", async () => {
      await importAll();
      await logAsB();
      const a = comparable(await recordsOf(db, A_ID));
      expect(a.length).toBeGreaterThanOrEqual(5);
      expect(a.map((r) => r.exercise_id).sort()).toEqual(expect.arrayContaining([ids.bench, ids.row, ids.carry]));
      expect(a).toEqual(comparable(await recordsOf(db, B_ID)));
      for (const id of Object.values(ids)) expect(await series(AS_A, id)).toEqual(await series(AS_B, id));
    });
  });

  describe("19.1 AC31 — export and purge", () => {
    it("the export carries the imported workouts and their links", async () => {
      await importAll();
      const res = await app.inject({ method: "GET", url: "/v1/account/export", headers: AS_A });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { workouts: { source: string }[]; hevy: { links: { origin: string; hevyWorkoutId: string }[] } };
      expect(body.workouts.filter((w) => w.source === "hevy")).toHaveLength(12);
      expect(body.hevy.links.map((l) => l.origin)).toEqual(Array(12).fill("imported"));
    });

    it("a deleted imported workout leaves its tombstone, and a re-import answers deleted_in_sin", async () => {
      await importAll();
      const [w] = await db.prisma.$queryRawUnsafe<{ workout_id: string }[]>(`SELECT workout_id::text FROM hevy_link WHERE hevy_workout_id = 'hist-03'`);
      expect((await app.inject({ method: "DELETE", url: `/v1/workouts/${w!.workout_id}`, headers: AS_A })).statusCode).toBe(204);
      const again = await app.inject({ method: "POST", url: "/v1/hevy/import/workouts", headers: AS_A, payload: { dryRun: false, workouts: [HISTORY[3]] } });
      expect((again.json() as { results: { outcome: string }[] }).results[0]!.outcome).toBe("deleted_in_sin");
    });

    it("account:purge removes the imported workouts and links", async () => {
      await importAll();
      await db.prisma.$executeRawUnsafe(`UPDATE "user" SET deleted_at = now() - interval '60 days' WHERE id = $1::uuid`, A_ID);
      const summary = await runPurge(db.prisma, silent, { confirm: true, skipGrace: true, userId: A_ID });
      expect(summary).toMatchObject({ purged: 1, failed: 0 });
      const left = await db.prisma.$queryRawUnsafe<{ workouts: number; links: number; account: number }[]>(
        `SELECT (SELECT count(*) FROM workout WHERE user_id = $1::uuid)::int AS workouts,
                (SELECT count(*) FROM hevy_link WHERE user_id = $1::uuid)::int AS links,
                (SELECT count(*) FROM hevy_account WHERE user_id = $1::uuid)::int AS account`,
        A_ID,
      );
      expect(left).toEqual([{ workouts: 0, links: 0, account: 0 }]);
    });
  });

  describe("19.1 AC34 — existing behavior unchanged", () => {
    it("POST /v1/workouts still stores source manual", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/workouts",
        headers: AS_B,
        payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() },
      });
      expect(res.statusCode).toBe(201);
      const [row] = await db.prisma.$queryRawUnsafe<{ source: string }[]>(`SELECT source FROM workout WHERE user_id = $1::uuid`, B_ID);
      expect(row).toEqual({ source: "manual" });
    });
  });
});
