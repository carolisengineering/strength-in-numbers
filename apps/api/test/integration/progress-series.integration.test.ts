import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, TRUNCATE_ALL } from "./records-helpers.js";
import { ProgressSeriesSchema } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";

const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 8, day, hour)); // Sept 2026

describe.skipIf(!shouldRunIntegration())("Spec 07.2 — getProgressSeries (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  const series = (userId: string, exerciseId: string, range: { from?: string; to?: string } = {}) =>
    createPersonalRecordRepository(db.prisma).getProgressSeries(userId, exerciseId, range);

  describe("AC2 — not found / not visible", () => {
    it("unknown id, another user's custom and another user's fork → NotFoundError", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const global = await insertExercise(db);
      const bCustom = await insertExercise(db, { ownerUserId: b });
      const bFork = await insertExercise(db, { ownerUserId: b, forkedFrom: global });
      for (const id of [uuidv7(), bCustom, bFork]) {
        await expect(series(a, id)).rejects.toBeInstanceOf(NotFoundError);
      }
    });
    it("a retired own custom exercise and a retired global still chart", async () => {
      const u = await insertUser(db);
      const custom = await insertExercise(db, { ownerUserId: u });
      const global = await insertExercise(db);
      await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: custom, sets: [{ reps: 5, weight: 50 }] }, { exerciseId: global, sets: [{ reps: 5, weight: 60 }] }] });
      await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = ANY($1::uuid[])`, [custom, global]);
      expect((await series(u, custom)).points).toHaveLength(1);
      expect((await series(u, global)).points).toHaveLength(1);
    });
  });

  describe("AC4 — fork lineage", () => {
    it("global, fork and second fork give identical series rooted at the global; Review Focus 3: upper-case id too", async () => {
      const u = await insertUser(db);
      const global = await insertExercise(db);
      const f1 = await insertExercise(db, { ownerUserId: u, forkedFrom: global });
      const f2 = await insertExercise(db, { ownerUserId: u, forkedFrom: global });
      await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: global, sets: [{ reps: 5, weight: 100 }] }] });
      await logWorkout(db, u, { startedAt: at(2), exercises: [{ exerciseId: f1, sets: [{ reps: 5, weight: 105 }] }] });
      await logWorkout(db, u, { startedAt: at(3), exercises: [{ exerciseId: f2, sets: [{ reps: 5, weight: 110 }] }] });
      const byGlobal = await series(u, global);
      expect(byGlobal.exerciseId).toBe(global);
      expect(byGlobal.points.map((p) => p.topSetWeightMilli)).toEqual([100_000, 105_000, 110_000]);
      expect(await series(u, f1)).toEqual(byGlobal);
      expect(await series(u, f2)).toEqual(byGlobal);
      expect(await series(u, f1.toUpperCase())).toEqual(byGlobal);
    });
    it("a from-scratch custom exercise is its own root", async () => {
      const u = await insertUser(db);
      const custom = await insertExercise(db, { ownerUserId: u });
      expect((await series(u, custom)).exerciseId).toBe(custom);
    });
  });

  describe("AC5/AC6 — scope and one point per workout", () => {
    it("warm-up/drop/failure, in-progress and other users' sets never count; unticked working sets do; fork + origin in one workout is one point; warm-up-only workout has no point", async () => {
      const u = await insertUser(db);
      const other = await insertUser(db);
      const global = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: u, forkedFrom: global });
      const { workoutId: combined } = await logWorkout(db, u, {
        startedAt: at(1),
        exercises: [
          { exerciseId: fork, position: 0, sets: [{ reps: 5, weight: 100, isComplete: false }, { setType: "warmup", reps: 5, weight: 300 }] },
          { exerciseId: global, position: 1, sets: [{ reps: 3, weight: 110 }, { setType: "drop", reps: 5, weight: 250 }] },
        ],
      });
      await logWorkout(db, u, { startedAt: at(2), exercises: [{ exerciseId: global, sets: [{ setType: "warmup", reps: 5, weight: 60 }, { setType: "failure", reps: 1, weight: 200 }] }] });
      await logWorkout(db, u, { startedAt: at(3), finish: "none", exercises: [{ exerciseId: global, sets: [{ reps: 5, weight: 300 }] }] });
      await logWorkout(db, other, { startedAt: at(4), exercises: [{ exerciseId: global, sets: [{ reps: 5, weight: 400 }] }] });
      const s = await series(u, global);
      // one point: 100×5 (unticked) + 110×3 → top 110.000; volume 500 + 330 = 830.000; e1RM max(116.667, 121.000) = 121.000
      expect(s.points).toEqual([
        expect.objectContaining({ workoutId: combined, topSetWeightMilli: 110_000, bestE1rmMilli: 121_000, totalVolumeMilli: 830_000, maxRepsMilli: null }),
      ]);
    });
    it("a duration lineage's working sets give an all-null point (D7)", async () => {
      const u = await insertUser(db);
      const plank = await insertExercise(db, { modality: "duration" });
      await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: plank, modality: "duration", sets: [{ durationS: 60 }] }] });
      expect((await series(u, plank)).points).toEqual([
        expect.objectContaining({ topSetWeightMilli: null, bestE1rmMilli: null, totalVolumeMilli: null, maxRepsMilli: null }),
      ]);
    });
  });

  describe("AC7 — a representative session through Postgres", () => {
    it("lb-entered weight uses the stored weight_kg; bodyweight lineage gives maxReps", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const pullup = await insertExercise(db, { modality: "bodyweight_reps" });
      await logWorkout(db, u, {
        startedAt: at(1),
        exercises: [
          { exerciseId: bench, sets: [{ reps: 3, weight: 135, weightUnit: "lb" }] }, // weight_kg 61.235 → top 61.235, volume 183.705
          { exerciseId: pullup, modality: "bodyweight_reps", sets: [{ reps: 8 }, { reps: 11 }] },
        ],
      });
      expect((await series(u, bench)).points[0]).toMatchObject({ topSetWeightMilli: 61_235, totalVolumeMilli: 183_705 });
      expect((await series(u, pullup)).points[0]).toMatchObject({ maxRepsMilli: 11_000, topSetWeightMilli: null });
    });
  });

  describe("AC9 — order is (started_at, id) ascending", () => {
    it("same started_at ties by id; a backdated workout finished last sits at its true place", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const late = (await logWorkout(db, u, { startedAt: at(10), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] })).workoutId;
      const t1 = (await logWorkout(db, u, { startedAt: at(5), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] })).workoutId;
      const t2 = (await logWorkout(db, u, { startedAt: at(5), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] })).workoutId;
      const backdated = (await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] })).workoutId;
      const tied = [t1, t2].sort();
      expect((await series(u, bench)).points.map((p) => p.workoutId)).toEqual([backdated, ...tied, late]);
    });
  });

  describe("AC10 — from / to on local_date, inclusive", () => {
    it("bounds, one-sided ranges, local_date (not UTC date), values independent of the range; Review Focus 4 and 5", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const ids: string[] = [];
      for (const d of [1, 2, 3, 4, 5]) {
        ids.push((await logWorkout(db, u, { startedAt: at(d), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 + d }] }] })).workoutId);
      }
      // Review Focus 4: a second (evening) session on day 3
      const evening = (await logWorkout(db, u, { startedAt: at(3, 20), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 99 }] }] })).workoutId;
      // A late-evening session whose UTC date is day 6 but whose local_date is day 5
      const lateLocal = (await logWorkout(db, u, { startedAt: new Date(Date.UTC(2026, 8, 6, 2)), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 98 }] }] })).workoutId;
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET local_date = '2026-09-05' WHERE id = $1::uuid`, lateLocal);

      const all = await series(u, bench);
      const idsIn = async (range: { from?: string; to?: string }) => (await series(u, bench, range)).points.map((p) => p.workoutId);
      expect(await idsIn({ from: "2026-09-02", to: "2026-09-04" })).toEqual([ids[1], ids[2], evening, ids[3]]);
      expect(await idsIn({ from: "2026-09-04" })).toEqual([ids[3], ids[4], lateLocal]);
      expect(await idsIn({ to: "2026-09-02" })).toEqual([ids[0], ids[1]]);
      expect(await idsIn({ from: "2026-09-03", to: "2026-09-03" })).toEqual([ids[2], evening]);
      // Review Focus 5: a slice that excludes the heaviest session keeps every point's values
      const slice = await series(u, bench, { to: "2026-09-04" });
      for (const p of slice.points) expect(p).toEqual(all.points.find((q) => q.workoutId === p.workoutId));
      expect(Math.max(...slice.points.map((p) => p.topSetWeightMilli!))).toBe(104_000); // the PR (105, day 5) is outside the slice
    });
  });

  describe("AC11 — a known exercise with no sessions", () => {
    it("never trained, or nothing in range → points: []", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      expect(await series(u, bench)).toEqual({ exerciseId: bench, points: [] });
      await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      expect((await series(u, bench, { from: "2026-10-01" })).points).toEqual([]);
    });
  });
  describe("AC1/AC2 (HTTP) — real wiring; byte-identical 404s", () => {
    it("serves a schema-valid series; unknown and foreign ids give identical 404 bodies", async () => {
      const app = await buildApp({
        config: testConfig(),
        logger: false,
        checkReadiness: () => checkDatabaseReady(db.prisma),
        tokenVerifier: fakeVerifier((t) => authContext({ authSub: `auth0|${t}`, email: `${t}@ex.com` })),
        userRepository: createUserRepository(db.prisma),
        exerciseRepository: createExerciseRepository(db.prisma),
        workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
        personalRecordRepository: createPersonalRecordRepository(db.prisma),
        routineRepository: createRoutineRepository(db.prisma),
        rateLimits: GENEROUS_LIMITS,
      });
      try {
        const A = { authorization: "Bearer a" };
        const B = { authorization: "Bearer b" };
        const userA = (await app.inject({ method: "GET", url: "/v1/me", headers: A })).json().id as string;
        const userB = (await app.inject({ method: "GET", url: "/v1/me", headers: B })).json().id as string;
        const global = await insertExercise(db);
        const bCustom = await insertExercise(db, { ownerUserId: userB });
        const bFork = await insertExercise(db, { ownerUserId: userB, forkedFrom: global });
        await logWorkout(db, userA, { startedAt: at(1), exercises: [{ exerciseId: global, sets: [{ reps: 5, weight: 100 }] }] });

        const ok = await app.inject({ method: "GET", url: `/v1/progress/exercises/${global}`, headers: A });
        expect(ok.statusCode).toBe(200);
        expect(ProgressSeriesSchema.parse(ok.json()).points).toHaveLength(1);

        const bodies = new Set<string>();
        for (const id of [uuidv7(), bCustom, bFork]) {
          const res = await app.inject({ method: "GET", url: `/v1/progress/exercises/${id}`, headers: A });
          expect(res.statusCode).toBe(404);
          const body = res.json();
          delete body.instance; // the request path differs by design
          bodies.add(JSON.stringify(body));
        }
        expect(bodies.size).toBe(1);
      } finally {
        await app.close();
      }
    });
  });
});
