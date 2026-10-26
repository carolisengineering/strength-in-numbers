import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import type { Modality } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

const TOKEN_A = "new-modalities-a-token";
const TOKEN_B = "new-modalities-b-token";
const BEARER_A = { authorization: `Bearer ${TOKEN_A}` };
const JSON_A = { ...BEARER_A, "content-type": "application/json" };
const JSON_B = { authorization: `Bearer ${TOKEN_B}`, "content-type": "application/json" };

/**
 * Spec 05.3 Phase A over HTTP and real Postgres: the three new modalities and the ft unit through the
 * set routes, the finish rule, finished-workout edits, History and the export.
 */
describe.skipIf(!shouldRunIntegration())("Spec 05.3 Phase A — new modalities over HTTP (real Postgres)", () => {
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
        if (token === TOKEN_A) return authContext({ authSub: "auth0|nm-a", email: "a@ex.com" });
        if (token === TOKEN_B) return authContext({ authSub: "auth0|nm-b", email: "b@ex.com" });
        throw new Error(`unexpected bearer token in test: ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
    });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "personal_record", "set_entry", "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  /** A live workout for `headers`' user with one card per modality (global exercises). */
  async function workoutWith(modalities: Modality[], headers = JSON_A) {
    await app.inject({ method: "GET", url: "/v1/me", headers });
    const w = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    expect(w.statusCode).toBe(201);
    const weIds: string[] = [];
    for (const m of modalities) {
      const exerciseId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, $2, $3, true)`,
        exerciseId,
        `Ex ${m} ${exerciseId.slice(-4)}`,
        m,
      );
      const we = await app.inject({ method: "POST", url: `/v1/workouts/${w.json().id}/exercises`, headers, payload: { exerciseId } });
      expect(we.statusCode).toBe(201);
      weIds.push(we.json().id);
    }
    return { workoutId: w.json().id as string, weIds };
  }
  const postSet = (weId: string, payload: object, headers = JSON_A) =>
    app.inject({ method: "POST", url: `/v1/workout-exercises/${weId}/sets`, headers, payload });
  const patchSet = (id: string, payload: object) => app.inject({ method: "PATCH", url: `/v1/sets/${id}`, headers: JSON_A, payload });
  const finish = (workoutId: string) =>
    app.inject({ method: "PATCH", url: `/v1/workouts/${workoutId}`, headers: JSON_A, payload: { endedAt: new Date().toISOString() } });
  const paths = (res: { json: () => { errors?: { path: string }[] } }) => (res.json().errors ?? []).map((e) => e.path).sort();

  describe("05.3 AC6 — calories sets", () => {
    it("create, patch, clear, delete and replay", async () => {
      const { weIds } = await workoutWith(["calories"]);
      const key = uuidv7();
      const created = await postSet(weIds[0]!, { clientGeneratedId: key, calories: 20, isComplete: true });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        calories: 20, reps: null, weight: null, weightKg: null, distance: null, distanceM: null, durationS: null,
      });
      const id = created.json().id;
      expect((await patchSet(id, { calories: 25 })).json().calories).toBe(25);
      const cleared = await patchSet(id, { calories: null, isComplete: false });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().calories).toBeNull();
      await patchSet(id, { calories: 30, isComplete: true });
      const replay = await postSet(weIds[0]!, { clientGeneratedId: key, calories: 99 });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().calories).toBe(30);
      expect((await app.inject({ method: "DELETE", url: `/v1/sets/${id}`, headers: BEARER_A })).statusCode).toBe(204);
    });

    it("a calories set on another user's workout exercise is 404", async () => {
      const { weIds } = await workoutWith(["calories"], JSON_B);
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
      expect((await postSet(weIds[0]!, { calories: 20 })).statusCode).toBe(404);
    });
  });

  describe("05.3 AC7 — weight + distance sets", () => {
    it("201 with the generated canonical values; lb and km convert", async () => {
      const { weIds } = await workoutWith(["weight_distance"]);
      const kg = await postSet(weIds[0]!, { weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "m", isComplete: true });
      expect(kg.statusCode).toBe(201);
      expect(kg.json()).toMatchObject({ weightKg: 24, distanceM: 40, reps: null, durationS: null, calories: null });
      const lb = await postSet(weIds[0]!, { weight: 50, weightUnit: "lb", distance: 0.5, distanceUnit: "km", isComplete: true });
      expect(lb.statusCode).toBe(201);
      expect(lb.json().weightKg).toBeCloseTo(22.68, 2);
      expect(lb.json().distanceM).toBe(500);
    });
    it("a complete set missing distance names it; reps, durationS and calories are refused", async () => {
      const { weIds } = await workoutWith(["weight_distance"]);
      const missing = await postSet(weIds[0]!, { weight: 24, weightUnit: "kg", isComplete: true });
      expect(missing.statusCode).toBe(422);
      expect(paths(missing)).toEqual(["distance"]);
      const bad = await postSet(weIds[0]!, { weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "m", reps: 5, durationS: 9, calories: 3 });
      expect(bad.statusCode).toBe(422);
      expect(paths(bad)).toEqual(["calories", "durationS", "reps"]);
    });
  });

  describe("05.3 AC8 — weight + duration sets", () => {
    it("201; missing durationS is 422; distance is refused", async () => {
      const { weIds } = await workoutWith(["weight_duration"]);
      const ok = await postSet(weIds[0]!, { weight: 20, weightUnit: "kg", durationS: 90, isComplete: true });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ weightKg: 20, durationS: 90, reps: null, distance: null, calories: null });
      const missing = await postSet(weIds[0]!, { weight: 20, weightUnit: "kg", isComplete: true });
      expect(paths(missing)).toEqual(["durationS"]);
      const bad = await postSet(weIds[0]!, { weight: 20, weightUnit: "kg", durationS: 90, distance: 10, distanceUnit: "m" });
      expect(paths(bad)).toEqual(["distance"]);
    });
  });

  describe("05.3 AC9 — calories on a legacy modality, and rpe everywhere", () => {
    it("calories on weight_reps is 422 at calories; rpe is accepted on calories", async () => {
      const { weIds } = await workoutWith(["weight_reps", "calories"]);
      const bad = await postSet(weIds[0]!, { weight: 60, weightUnit: "kg", reps: 5, calories: 20 });
      expect(bad.statusCode).toBe(422);
      expect(paths(bad)).toEqual(["calories"]);
      expect((await postSet(weIds[1]!, { calories: 12, rpe: 8, isComplete: true })).statusCode).toBe(201);
    });
    it("Review Focus 1 — PATCH { isComplete: true } on a legacy weight_reps set is 200", async () => {
      const { weIds } = await workoutWith(["weight_reps"]);
      const s = await postSet(weIds[0]!, { weight: 60, weightUnit: "kg", reps: 5 });
      const r = await patchSet(s.json().id, { isComplete: true });
      expect(r.statusCode).toBe(200);
      expect(r.json().calories).toBeNull();
    });
  });

  describe("05.3 AC40 — ft through the API", () => {
    it("an ft set on weight_distance and on distance_duration returns ft and the generated meters", async () => {
      const { weIds } = await workoutWith(["weight_distance", "distance_duration"]);
      const carry = await postSet(weIds[0]!, { weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "ft", isComplete: true });
      expect(carry.statusCode).toBe(201);
      expect(carry.json()).toMatchObject({ distanceUnit: "ft", distance: 40, distanceM: 12.192 });
      const run = await postSet(weIds[1]!, { distance: 100, distanceUnit: "ft", durationS: 20, isComplete: true });
      expect(run.json()).toMatchObject({ distanceUnit: "ft", distanceM: 30.48 });
    });
  });
  describe("05.3 AC10 — finish integrity for the new types", () => {
    const cases: [Modality, object, object][] = [
      ["calories", {}, { calories: 20 }],
      ["weight_distance", { weight: 24, weightUnit: "kg" }, { distance: 40, distanceUnit: "m" }],
      ["weight_duration", { durationS: 60 }, { weight: 20, weightUnit: "kg" }],
    ];
    for (const [modality, half, rest] of cases) {
      it(`${modality}: a half-filled working set blocks the finish (409); filled, it finishes`, async () => {
        const { workoutId, weIds } = await workoutWith([modality]);
        const s = await postSet(weIds[0]!, { setType: "working", ...half });
        expect(s.statusCode).toBe(201);
        await postSet(weIds[0]!, { setType: "warmup" });
        const blocked = await finish(workoutId);
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json().type).toContain("incomplete-working-sets");
        expect((await patchSet(s.json().id, { ...rest, isComplete: true })).statusCode).toBe(200);
        expect((await finish(workoutId)).statusCode).toBe(200);
      });
    }
    it("Review Focus 3 — finishing a complete calories workout writes no personal_record row", async () => {
      const { workoutId, weIds } = await workoutWith(["calories"]);
      await postSet(weIds[0]!, { calories: 20, isComplete: true });
      expect((await finish(workoutId)).statusCode).toBe(200);
      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "personal_record"`);
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });

  describe("05.3 AC11 — finished-workout edit integrity", () => {
    it("a weight_duration working set without durationS is 422 on a finished workout; a warmup is 201", async () => {
      const { workoutId, weIds } = await workoutWith(["weight_duration"]);
      await postSet(weIds[0]!, { weight: 20, weightUnit: "kg", durationS: 90, isComplete: true });
      expect((await finish(workoutId)).statusCode).toBe(200);
      const body = { weight: 20, weightUnit: "kg", isComplete: true };
      const refused = await postSet(weIds[0]!, { setType: "working", ...body });
      expect(refused.statusCode).toBe(422);
      expect(paths(refused)).toEqual(["durationS"]);
      const detail = await app.inject({ method: "GET", url: `/v1/workouts/${workoutId}`, headers: BEARER_A });
      expect(detail.json().exercises[0].sets).toHaveLength(1);
      expect((await postSet(weIds[0]!, { setType: "warmup", weight: 20, weightUnit: "kg" })).statusCode).toBe(201);
    });
  });

  describe("05.3 AC14 — export", () => {
    it("a calories set equals GET /v1/workouts/{id}; modalities are served; a legacy set carries calories: null", async () => {
      const { workoutId, weIds } = await workoutWith(["calories", "weight_reps"]);
      await postSet(weIds[0]!, { calories: 20, isComplete: true });
      await postSet(weIds[1]!, { weight: 60, weightUnit: "kg", reps: 5, isComplete: true });
      await finish(workoutId);
      const detail = (await app.inject({ method: "GET", url: `/v1/workouts/${workoutId}`, headers: BEARER_A })).json();
      const exp = await app.inject({ method: "GET", url: "/v1/account/export", headers: BEARER_A });
      expect(exp.statusCode).toBe(200);
      const exported = exp.json().workouts.find((w: { id: string }) => w.id === workoutId);
      expect(exported.exercises[0].modalitySnapshot).toBe("calories");
      expect(exported.exercises[0].sets[0]).toEqual(detail.exercises[0].sets[0]);
      const legacy = exported.exercises[1].sets[0];
      expect(Object.keys(legacy)).toContain("calories");
      expect(legacy.calories).toBeNull();
    });
  });

  describe("05.3 AC15 — History volume", () => {
    const historyRow = async (workoutId: string) =>
      (await app.inject({ method: "GET", url: "/v1/workouts", headers: BEARER_A })).json().items.find((w: { id: string }) => w.id === workoutId);
    it("a calories-only workout has totalVolume null and its working-set count", async () => {
      const { workoutId, weIds } = await workoutWith(["calories"]);
      await postSet(weIds[0]!, { calories: 20, isComplete: true });
      await postSet(weIds[0]!, { calories: 25, isComplete: true });
      await finish(workoutId);
      expect(await historyRow(workoutId)).toMatchObject({ totalVolume: null, workingSetCount: 2, exerciseCount: 1 });
    });
    it("a weight_reps + weight_distance workout's volume is the weight_reps sets alone", async () => {
      const { workoutId, weIds } = await workoutWith(["weight_reps", "weight_distance"]);
      await postSet(weIds[0]!, { weight: 100, weightUnit: "kg", reps: 5, isComplete: true });
      await postSet(weIds[1]!, { weight: 50, weightUnit: "kg", distance: 40, distanceUnit: "m", isComplete: true });
      await finish(workoutId);
      expect((await historyRow(workoutId)).totalVolume).toBe(500);
    });
  });
});
