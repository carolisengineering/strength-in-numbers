import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, TRUNCATE_ALL } from "./records-helpers.js";

const A = { authorization: "Bearer a" };
const B = { authorization: "Bearer b" };

/** Spec 03.4 AC21–AC25 — `GET /v1/exercises/{id}/routines`, the delete warning's list, against a real Postgres. */
describe.skipIf(!shouldRunIntegration())("Spec 03.4 Phase B — routines that use an exercise (real Postgres)", () => {
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
        if (token === "a") return authContext({ authSub: "auth0|routines-a", email: "a@ex.com" });
        if (token === "b") return authContext({ authSub: "auth0|routines-b", email: "b@ex.com" });
        throw new Error(`unexpected token ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
      rateLimits: GENEROUS_LIMITS,
    });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL); // routines cascade from "user"
  });

  const me = async (headers = A) => ((await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { id: string }).id;
  /** A routine whose items use `exerciseIds` in order; `oneOffUntil` marks a one-off. */
  async function routine(userId: string, name: string, exerciseIds: string[], oneOffUntil: Date | null = null) {
    const id = uuidv7();
    // A one-off's expiry must follow its creation (0013's CHECK), so an expired one is created further back.
    const createdAt = oneOffUntil !== null && oneOffUntil.getTime() < Date.now() ? new Date(oneOffUntil.getTime() - 14 * 86_400_000) : new Date();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine" ("id","user_id","name","one_off_until","created_at") VALUES ($1::uuid,$2::uuid,$3,$4,$5)`, id, userId, name, oneOffUntil, createdAt);
    for (const [position, exerciseId] of exerciseIds.entries()) {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "routine_item" ("id","routine_id","position","exercise_id") VALUES ($1::uuid,$2::uuid,$3,$4::uuid)`, uuidv7(), id, position, exerciseId);
    }
    return id;
  }
  const using = (exerciseId: string, headers = A) => app.inject({ method: "GET", url: `/v1/exercises/${exerciseId}/routines`, headers });

  describe("03.4 AC21 — shape and order", () => {
    it("every routine using the exercise once, by lower(name) then id, with only id, name, oneOffUntil", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user });
      const other = await insertExercise(db, { ownerUserId: user });
      const pushB = await routine(user, "push B", [ex]);
      const arms = await routine(user, "Arms", [ex, other]);
      const leg = await routine(user, "leg day", [ex]);
      await routine(user, "Other", [other]);
      const res = await using(ex);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        routines: [
          { id: arms, name: "Arms", oneOffUntil: null },
          { id: leg, name: "leg day", oneOffUntil: null },
          { id: pushB, name: "push B", oneOffUntil: null },
        ],
      });
    });
    it("Review Focus 5 — a routine using the exercise twice is listed once", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user });
      const r = await routine(user, "Twice", [ex, ex]);
      expect((await using(ex)).json()).toEqual({ routines: [{ id: r, name: "Twice", oneOffUntil: null }] });
    });
    it("none gives an empty list", async () => {
      const user = await me();
      expect((await using(await insertExercise(db, { ownerUserId: user }))).json()).toEqual({ routines: [] });
    });
  });

  describe("03.4 AC22 — ownership and visibility", () => {
    it("another user's exercise, an absent id and a malformed id are 404", async () => {
      await me();
      const b = await me(B);
      const theirs = await insertExercise(db, { ownerUserId: b });
      for (const id of [theirs, uuidv7(), "not-a-uuid"]) expect((await using(id)).statusCode).toBe(404);
    });
    it("Review Focus 2 — a built-in lists only the caller's routines", async () => {
      const a = await me();
      const b = await me(B);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      const mine = await routine(a, "Mine", [builtIn]);
      await routine(b, "Theirs", [builtIn]);
      expect((await using(builtIn)).json()).toEqual({ routines: [{ id: mine, name: "Mine", oneOffUntil: null }] });
    });
    it("Review Focus 3 — a deleted own exercise still answers 200 with its routines", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user });
      const r = await routine(user, "Keep", [ex]);
      expect((await app.inject({ method: "DELETE", url: `/v1/exercises/${ex}`, headers: A })).statusCode).toBe(204);
      const res = await using(ex);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ routines: [{ id: r, name: "Keep", oneOffUntil: null }] });
    });
  });

  describe("03.4 AC23 — exact id, not lineage", () => {
    it("a routine on the built-in is not listed for the fork, nor the reverse", async () => {
      const user = await me();
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      const fork = await insertExercise(db, { ownerUserId: user, forkedFrom: builtIn });
      const onBuiltIn = await routine(user, "On built-in", [builtIn]);
      const onFork = await routine(user, "On fork", [fork]);
      expect((await using(builtIn)).json().routines.map((r: { id: string }) => r.id)).toEqual([onBuiltIn]);
      expect((await using(fork)).json().routines.map((r: { id: string }) => r.id)).toEqual([onFork]);
    });
  });

  describe("03.4 AC24 — one-offs", () => {
    it("listed with oneOffUntil; an expired one is listed too and nothing is swept", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user });
      const later = new Date(Date.now() + 7 * 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      const live = await routine(user, "A one-off", [ex], later);
      const expired = await routine(user, "B expired", [ex], past);
      const plain = await routine(user, "C plain", [ex]);
      const count = async () => Number((await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "routine"`))[0]!.n);
      const before = await count();
      expect((await using(ex)).json()).toEqual({
        routines: [
          { id: live, name: "A one-off", oneOffUntil: later.toISOString() },
          { id: expired, name: "B expired", oneOffUntil: past.toISOString() },
          { id: plain, name: "C plain", oneOffUntil: null },
        ],
      });
      expect(await count()).toBe(before);
    });
  });

  describe("03.4 AC25 — cache, publication, limits", () => {
    it("no-store, no ETag; all 50 routines in one response", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user });
      for (let i = 0; i < 50; i++) await routine(user, `R${String(i).padStart(2, "0")}`, [ex]);
      const res = await using(ex);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.etag).toBeUndefined();
      expect(res.json().routines).toHaveLength(50);
    });
  });
});
