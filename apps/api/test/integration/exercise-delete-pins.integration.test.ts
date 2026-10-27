import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const A = { authorization: "Bearer a" };
const B = { authorization: "Bearer b" };
const JSON_A = { ...A, "content-type": "application/json" };
const day = (d: number, h = 15) => new Date(Date.UTC(2026, 9, d, h));

/**
 * Spec 03.4 AC33–AC37 — characterization: a delete changes nothing but the exercise row, and the reads around it keep
 * working. If one of these fails, the delete changed; report it rather than adjusting the test.
 */
describe.skipIf(!shouldRunIntegration())("Spec 03.4 Phase B — the delete pins (real Postgres)", () => {
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
        if (token === "a") return authContext({ authSub: "auth0|pins-a", email: "a@ex.com" });
        if (token === "b") return authContext({ authSub: "auth0|pins-b", email: "b@ex.com" });
        throw new Error(`unexpected token ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
      hevyRepository: createHevyRepository(db.prisma),
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
  const inject = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: payload === undefined ? A : JSON_A, ...(payload === undefined ? {} : { payload: payload as object }) });

  /** An owned custom exercise with sets in two finished workouts (records through the finish path) and a live one, plus
   * an ordinary routine and a one-off routine that use it. */
  async function fixture() {
    const user = await me();
    const ex = await insertExercise(db, { ownerUserId: user, name: "Zercher Squat" });
    const finished: string[] = [];
    for (const [d, weight] of [[1, 100], [3, 110]] as const) {
      const w = await logWorkout(db, user, { startedAt: day(d), finish: "none", exercises: [{ exerciseId: ex, name: "Zercher Squat", sets: [{ reps: 5, weight }] }] });
      expect((await inject("PATCH", `/v1/workouts/${w.workoutId}`, { endedAt: new Date(day(d).getTime() + 3_600_000).toISOString() })).statusCode).toBe(200);
      finished.push(w.workoutId);
    }
    const live = await logWorkout(db, user, { startedAt: new Date(Date.now() - 1_800_000), finish: "none", exercises: [{ exerciseId: ex, name: "Zercher Squat", sets: [{ reps: 5, weight: 90 }] }] });
    const body = { name: "Leg day", items: [{ exerciseId: ex }] };
    const routine = await inject("POST", "/v1/routines", body);
    expect(routine.statusCode).toBe(201);
    const oneOff = await inject("POST", "/v1/routines", { name: "Class", items: [{ exerciseId: ex }], oneOff: true });
    expect(oneOff.statusCode).toBe(201);
    return { user, ex, finished, live: live.workoutId, routineId: routine.json().id as string, oneOffId: oneOff.json().id as string, body };
  }
  const hashes = async () =>
    (await db.prisma.$queryRawUnsafe<Record<string, string>[]>(`
      SELECT (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) FROM "set_entry" t) AS se,
             (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) FROM "workout_exercise" t) AS we,
             (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) FROM "personal_record" t) AS pr,
             (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) FROM "routine_item" t) AS ri`))[0]!;
  const row = async (id: string) =>
    (await db.prisma.$queryRawUnsafe<{ is_active: boolean; change_xid: string }[]>(`SELECT is_active, change_xid::text FROM "exercise" WHERE id = $1::uuid`, id))[0]!;

  describe("03.4 AC33 — delete semantics unchanged", () => {
    it("204, retired, change_xid bumped; a repeat is a 204 no-op; built-in 403; other or absent 404", async () => {
      const { ex } = await fixture();
      const before = await row(ex);
      expect((await inject("DELETE", `/v1/exercises/${ex}`)).statusCode).toBe(204);
      const after = await row(ex);
      expect(after.is_active).toBe(false);
      expect(after.change_xid).not.toBe(before.change_xid);
      expect((await inject("DELETE", `/v1/exercises/${ex}`)).statusCode).toBe(204);
      expect(await row(ex)).toEqual(after);
      const builtIn = await insertExercise(db);
      const res = await inject("DELETE", `/v1/exercises/${builtIn}`);
      expect([res.statusCode, res.json().type]).toEqual([403, expect.stringMatching(/\/exercise-immutable$/)]);
      const theirs = await insertExercise(db, { ownerUserId: await me(B) });
      expect((await inject("DELETE", `/v1/exercises/${theirs}`)).statusCode).toBe(404);
      expect((await inject("DELETE", `/v1/exercises/${uuidv7()}`)).statusCode).toBe(404);
    });
  });

  describe("03.4 AC34 — delete touches nothing else", () => {
    it("sets, cards, records and routine items are byte-identical; workouts still show the snapshot name", async () => {
      const { ex, finished } = await fixture();
      const before = await hashes();
      expect((await inject("DELETE", `/v1/exercises/${ex}`)).statusCode).toBe(204);
      expect(await hashes()).toEqual(before);
      const detail = (await inject("GET", `/v1/workouts/${finished[0]}`)).json() as { exercises: { exerciseNameSnapshot: string }[] };
      expect(detail.exercises[0]!.exerciseNameSnapshot).toBe("Zercher Squat");
      const history = (await inject("GET", "/v1/workouts")).json() as { items: { id: string; exerciseNames: string[] }[] };
      expect(history.items.find((w) => w.id === finished[0])!.exerciseNames).toContain("Zercher Squat");
    });
  });

  describe("03.4 AC35 — routines after a delete", () => {
    it("still read; PUT unchanged and start are exercise-retired; PUT without the item works; the warning still lists both", async () => {
      const { ex, routineId, oneOffId, body, live } = await fixture();
      expect((await inject("DELETE", `/v1/exercises/${ex}`)).statusCode).toBe(204);
      const read = (await inject("GET", `/v1/routines/${routineId}`)).json() as { items: { exerciseId: string }[] };
      expect(read.items.map((i) => i.exerciseId)).toEqual([ex]);
      const put = await inject("PUT", `/v1/routines/${routineId}`, body);
      expect(put.statusCode).toBe(409);
      expect(put.json()).toMatchObject({ type: expect.stringMatching(/\/exercise-retired$/), errors: [expect.objectContaining({ path: "items.0.exerciseId" })] });
      expect((await inject("PATCH", `/v1/workouts/${live}`, { endedAt: new Date().toISOString() })).statusCode).toBe(200);
      const start = await inject("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString(), routineId });
      expect([start.statusCode, start.json().type]).toEqual([409, expect.stringMatching(/\/exercise-retired$/)]);
      const using = (await inject("GET", `/v1/exercises/${ex}/routines`)).json() as { routines: { id: string }[] };
      expect(using.routines.map((r) => r.id).sort()).toEqual([routineId, oneOffId].sort());
      const other = await insertExercise(db);
      expect((await inject("PUT", `/v1/routines/${routineId}`, { name: "Leg day", items: [{ exerciseId: other }] })).statusCode).toBe(200);
    });
  });

  describe("03.4 AC36 — progress and records after a delete", () => {
    it("the progress series and the records for the deleted id are unchanged", async () => {
      const { ex } = await fixture();
      const progress = (await inject("GET", `/v1/progress/exercises/${ex}`)).json();
      const records = (await inject("GET", `/v1/personal-records?exerciseId=${ex}`)).json();
      expect(records.records.length).toBeGreaterThan(0);
      expect((await inject("DELETE", `/v1/exercises/${ex}`)).statusCode).toBe(204);
      const progressAfter = await inject("GET", `/v1/progress/exercises/${ex}`);
      expect(progressAfter.statusCode).toBe(200);
      expect(progressAfter.json()).toEqual(progress);
      const recordsAfter = await inject("GET", `/v1/personal-records?exerciseId=${ex}`);
      expect(recordsAfter.statusCode).toBe(200);
      expect(recordsAfter.json()).toEqual(records);
    });
    it("deleting a fork: the delta has its tombstone and no built-in row; the built-in's change_xid is unchanged", async () => {
      await me();
      const builtIn = await insertExercise(db);
      const fork = await inject("POST", `/v1/exercises/${builtIn}/fork`);
      expect(fork.statusCode).toBe(201);
      const forkId = fork.json().id as string;
      const token = (await inject("GET", "/v1/exercises")).json().syncToken as string;
      const builtInBefore = await row(builtIn);
      expect((await inject("DELETE", `/v1/exercises/${forkId}`)).statusCode).toBe(204);
      const delta = (await inject("GET", `/v1/exercises?since=${encodeURIComponent(token)}`)).json() as { exercises: { id: string; isActive: boolean }[] };
      expect(delta.exercises).toEqual([expect.objectContaining({ id: forkId, isActive: false })]);
      expect((await row(builtIn)).change_xid).toBe(builtInBefore.change_xid);
    });
  });

  describe("03.4 AC37 — a stale plan starts as planned", () => {
    it("a weight_reps plan on an exercise retyped to duration starts 201, copied verbatim, with the new snapshot", async () => {
      const user = await me();
      const ex = await insertExercise(db, { ownerUserId: user, modality: "weight_reps" });
      const created = await inject("POST", "/v1/routines", {
        name: "Stale",
        items: [{ exerciseId: ex, sets: [{ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }] }],
      });
      expect(created.statusCode).toBe(201);
      expect((await inject("PATCH", `/v1/exercises/${ex}`, { modality: "duration" })).statusCode).toBe(200);
      const start = await inject("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString(), routineId: created.json().id });
      expect(start.statusCode).toBe(201);
      const workoutId = start.json().id as string;
      const planned = await db.prisma.$queryRawUnsafe<{ reps_low: number; reps_high: number; weight: string; weight_unit: string; modality_snapshot: string }[]>(
        `SELECT ps.reps_low, ps.reps_high, ps.weight::text AS weight, ps.weight_unit, we.modality_snapshot
         FROM "workout_planned_set" ps JOIN "workout_exercise" we ON we.id = ps.workout_exercise_id WHERE we.workout_id = $1::uuid`, workoutId);
      expect(planned).toEqual([{ reps_low: 5, reps_high: 5, weight: "100.000", weight_unit: "kg", modality_snapshot: "duration" }]);
    });
  });
});
