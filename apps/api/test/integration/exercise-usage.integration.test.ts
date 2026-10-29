import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, logWorkout, TRUNCATE_ALL, type SetSpec } from "./records-helpers.js";

const A = { authorization: "Bearer a" };
const B = { authorization: "Bearer b" };
const JSON_A = { ...A, "content-type": "application/json" };
const at = (iso: string) => new Date(iso);

/** Spec 03.4 AC26–AC31 — `GET /v1/exercises/usage`, last logged per lineage root, against a real Postgres. */
describe.skipIf(!shouldRunIntegration())("Spec 03.4 Phase B — exercise usage (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => {
        if (token === "a") return authContext({ authSub: "auth0|usage-a", email: "a@ex.com" });
        if (token === "b") return authContext({ authSub: "auth0|usage-b", email: "b@ex.com" });
        throw new Error(`unexpected token ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
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
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  const me = async (headers = A) => ((await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { id: string }).id;
  const usage = (headers: Record<string, string> = A) => app.inject({ method: "GET", url: "/v1/exercises/usage", headers });
  const entries = async () => (await usage()).json().exercises as { rootId: string; lastLoggedOn: string }[];
  const log = (user: string, startedAt: string, exerciseId: string, sets: SetSpec[], finish: "raw" | "none" = "raw") =>
    logWorkout(db, user, { startedAt: at(startedAt), finish, exercises: [{ exerciseId, sets }] });

  describe("03.4 AC26 — shape and order", () => {
    it("newest first, ties by rootId; no sets gives an empty list", async () => {
      const user = await me();
      expect((await usage()).json()).toEqual({ exercises: [] });
      const [x, y, z] = [await insertExercise(db), await insertExercise(db), await insertExercise(db)];
      await log(user, "2026-10-20T15:00:00Z", x, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-24T15:00:00Z", y, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-24T16:00:00Z", z, [{ reps: 5, weight: 100 }]);
      const [first, second] = [y, z].sort();
      expect(await entries()).toEqual([
        { rootId: first, lastLoggedOn: "2026-10-24" },
        { rootId: second, lastLoggedOn: "2026-10-24" },
        { rootId: x, lastLoggedOn: "2026-10-20" },
      ]);
    });
  });

  describe("03.4 AC27 — keyed by lineage root", () => {
    it("a built-in and the caller's fork fold into one entry under the built-in, latest date", async () => {
      const user = await me();
      const builtIn = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: user, forkedFrom: builtIn });
      const custom = await insertExercise(db, { ownerUserId: user });
      await log(user, "2026-10-01T15:00:00Z", builtIn, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-05T15:00:00Z", fork, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-03T15:00:00Z", custom, [{ reps: 5, weight: 100 }]);
      expect(await entries()).toEqual([
        { rootId: builtIn, lastLoggedOn: "2026-10-05" },
        { rootId: custom, lastLoggedOn: "2026-10-03" },
      ]);
    });
  });

  describe("03.4 AC28 — the date is the workout's local_date", () => {
    it("a late-evening workout reports its local date; a Change Time moves it", async () => {
      const user = await me();
      const ex = await insertExercise(db);
      const w = await log(user, "2026-10-11T04:30:00Z", ex, [{ reps: 5, weight: 100 }]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET local_date = '2026-10-10', tz_offset_minutes = -300 WHERE id = $1::uuid`, w.workoutId);
      expect(await entries()).toEqual([{ rootId: ex, lastLoggedOn: "2026-10-10" }]);
      const moved = await app.inject({
        method: "PATCH",
        url: `/v1/workouts/${w.workoutId}`,
        headers: JSON_A,
        payload: { startedAt: "2026-10-12T15:00:00.000Z", tzOffsetMinutes: -300 },
      });
      expect(moved.statusCode).toBe(200);
      expect(await entries()).toEqual([{ rootId: ex, lastLoggedOn: "2026-10-12" }]);
    });
  });

  describe("03.4 AC29 — what counts as logged", () => {
    it.each<[string, SetSpec, "raw" | "none"]>([
      ["a warm-up only", { setType: "warmup", reps: 5, weight: 40 }, "raw"],
      ["an incomplete set", { reps: 5, weight: 40, isComplete: false }, "raw"],
      ["a set in the live workout", { reps: 5, weight: 40 }, "none"],
    ])("%s counts", async (_label, set, finish) => {
      const user = await me();
      const ex = await insertExercise(db);
      await log(user, "2026-10-20T15:00:00Z", ex, [set], finish);
      expect((await entries()).map((e) => e.rootId)).toEqual([ex]);
    });
    it("a card with no sets does not; deleting the last set, or the workout, removes the entry", async () => {
      const user = await me();
      const empty = await insertExercise(db);
      await log(user, "2026-10-19T15:00:00Z", empty, []);
      expect(await entries()).toEqual([]);
      const ex = await insertExercise(db);
      const w = await log(user, "2026-10-20T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "set_entry" WHERE id = $1::uuid`, w.setIds[0]![0]!);
      expect(await entries()).toEqual([]);
      const w2 = await log(user, "2026-10-21T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      expect((await entries()).map((e) => e.rootId)).toEqual([ex]);
      expect((await app.inject({ method: "DELETE", url: `/v1/workouts/${w2.workoutId}`, headers: A })).statusCode).toBe(204);
      expect(await entries()).toEqual([]);
    });
  });

  describe("Minor 113 — a retired fork's sets still count under its built-in", () => {
    it("log on a fork, delete the fork: the built-in's entry keeps the fork's date", async () => {
      const user = await me();
      const builtIn = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: user, forkedFrom: builtIn });
      await log(user, "2026-10-01T15:00:00Z", builtIn, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-09T15:00:00Z", fork, [{ reps: 5, weight: 100 }]);
      expect((await app.inject({ method: "DELETE", url: `/v1/exercises/${fork}`, headers: A })).statusCode).toBe(204);
      expect(await entries()).toEqual([{ rootId: builtIn, lastLoggedOn: "2026-10-09" }]);
    });
  });

  describe("Minor 114 — the latest of several workouts wins", () => {
    it("three workouts on different days, inserted out of date order", async () => {
      const user = await me();
      const ex = await insertExercise(db);
      await log(user, "2026-10-12T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-20T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      await log(user, "2026-10-04T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      expect(await entries()).toEqual([{ rootId: ex, lastLoggedOn: "2026-10-20" }]);
    });
  });

  describe("03.4 AC30 — scoped and complete", () => {
    it("another user's sets never appear; a deleted custom exercise keeps its entry", async () => {
      const user = await me();
      const other = await me(B);
      const theirs = await insertExercise(db);
      await log(other, "2026-10-20T15:00:00Z", theirs, [{ reps: 5, weight: 100 }]);
      const mine = await insertExercise(db, { ownerUserId: user });
      await log(user, "2026-10-21T15:00:00Z", mine, [{ reps: 5, weight: 100 }]);
      expect((await app.inject({ method: "DELETE", url: `/v1/exercises/${mine}`, headers: A })).statusCode).toBe(204);
      expect(await entries()).toEqual([{ rootId: mine, lastLoggedOn: "2026-10-21" }]);
    });
  });

  describe("03.4 AC31 — cache", () => {
    it("Review Focus 4 — private, no-cache with an ETag; 304 on a match; a new set and a Change Time each change it", async () => {
      const user = await me();
      const ex = await insertExercise(db);
      const w = await log(user, "2026-10-20T15:00:00Z", ex, [{ reps: 5, weight: 100 }]);
      const first = await usage();
      expect(first.headers["cache-control"]).toBe("private, no-cache");
      const etag = first.headers.etag as string;
      expect(etag).toBeTruthy();
      const again = await usage({ ...A, "if-none-match": etag });
      expect(again.statusCode).toBe(304);
      expect(again.body).toBe("");
      const other = await insertExercise(db);
      await log(user, "2026-10-21T15:00:00Z", other, [{ reps: 5, weight: 100 }]);
      const afterSet = (await usage()).headers.etag as string;
      expect(afterSet).not.toBe(etag);
      const moved = await app.inject({
        method: "PATCH",
        url: `/v1/workouts/${w.workoutId}`,
        headers: JSON_A,
        payload: { startedAt: "2026-10-18T15:00:00.000Z", tzOffsetMinutes: 0 },
      });
      expect(moved.statusCode).toBe(200);
      expect((await usage()).headers.etag).not.toBe(afterSet);
    });
  });
});
