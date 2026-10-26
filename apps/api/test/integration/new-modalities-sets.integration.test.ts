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

  describe("05.3 AC27 / AC28 / AC33 — records for the new types over HTTP", () => {
    const records = (query = "") => app.inject({ method: "GET", url: `/v1/personal-records${query}`, headers: BEARER_A });
    const byType = (rows: { recordType: string }[]) => Object.fromEntries(rows.map((r) => [r.recordType, r]));

    it("finish writes them, the GET reads them as numbers in their units, and filters work", async () => {
      const { workoutId, weIds } = await workoutWith(["calories", "weight_distance", "weight_duration"]);
      expect((await postSet(weIds[0]!, { calories: 20, isComplete: true })).statusCode).toBe(201);
      expect((await postSet(weIds[1]!, { weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "m", isComplete: true })).statusCode).toBe(201);
      expect((await postSet(weIds[2]!, { weight: 20, weightUnit: "kg", durationS: 90, isComplete: true })).statusCode).toBe(201);
      const done = await finish(workoutId);
      expect(done.statusCode).toBe(200);
      const fresh = done.json().newRecords as { recordType: string; value: number; unit: string; previousValue: number | null }[];
      expect(fresh.map((r) => `${r.recordType}:${r.value}${r.unit}`).sort()).toEqual([
        "heaviest_weight:20kg",
        "heaviest_weight:24kg",
        "max_calories:20cal",
        "max_distance:40m",
        "max_duration:90s",
      ]);
      const all = await records();
      expect(all.statusCode).toBe(200);
      const rows = all.json().records as { recordType: string; value: number; unit: string; exerciseId: string }[];
      expect(rows).toHaveLength(5);
      const calRow = rows.find((r) => r.recordType === "max_calories")!;
      expect(calRow).toMatchObject({ value: 20, unit: "cal" });
      expect(rows.find((r) => r.recordType === "max_distance")).toMatchObject({ value: 40, unit: "m" });
      expect(rows.find((r) => r.recordType === "max_duration")).toMatchObject({ value: 90, unit: "s" });
      expect((await records(`?exerciseId=${calRow.exerciseId}`)).json().records.map((r: { recordType: string }) => r.recordType)).toEqual(["max_calories"]);
      expect((await records(`?workoutId=${workoutId}`)).json().records).toHaveLength(5);
    });

    it("a later finish reports the earlier best as previousValue; History's recordCount equals the finish summary", async () => {
      const first = await workoutWith(["calories"]);
      await postSet(first.weIds[0]!, { calories: 20, isComplete: true });
      await finish(first.workoutId);
      const exerciseId = (await app.inject({ method: "GET", url: `/v1/workouts/${first.workoutId}`, headers: BEARER_A })).json().exercises[0].exerciseId;
      const second = await workoutWith([]);
      const we = await app.inject({ method: "POST", url: `/v1/workouts/${second.workoutId}/exercises`, headers: JSON_A, payload: { exerciseId } });
      await postSet(we.json().id, { calories: 25, isComplete: true });
      const done = await finish(second.workoutId);
      const fresh = done.json().newRecords as { recordType: string; value: number; previousValue: number | null }[];
      expect(fresh).toHaveLength(1);
      expect(byType(fresh).max_calories).toMatchObject({ value: 25, previousValue: 20 });
      const summaryCount = fresh.filter((r) => r.recordType !== "best_set_volume").length;
      const history = (await app.inject({ method: "GET", url: "/v1/workouts", headers: BEARER_A })).json().items as { id: string; recordCount: number }[];
      expect(history.find((h) => h.id === second.workoutId)!.recordCount).toBe(summaryCount);
      expect(history.find((h) => h.id === first.workoutId)!.recordCount).toBe(0);
    });
  });

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
    it("Review Focus 3 — finishing a complete calories workout writes only its max_calories row (Phase B)", async () => {
      const { workoutId, weIds } = await workoutWith(["calories"]);
      await postSet(weIds[0]!, { calories: 20, isComplete: true });
      expect((await finish(workoutId)).statusCode).toBe(200);
      const rows = await db.prisma.$queryRawUnsafe<{ record_type: string }[]>(`SELECT record_type FROM "personal_record"`);
      expect(rows.map((r) => r.record_type)).toEqual(["max_calories"]);
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
  describe("05.3 AC5 — exercise writes accept the new values", () => {
    const create = (payload: object, headers = JSON_A) => app.inject({ method: "POST", url: "/v1/exercises", headers, payload });
    it("create each new modality; fork with a weight_distance overlay; PATCH to weight_duration; GET serves it", async () => {
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
      for (const modality of ["calories", "weight_distance", "weight_duration"] as const) {
        const r = await create({ name: `Custom ${modality}`, modality });
        expect(r.statusCode).toBe(201);
        expect(r.json().modality).toBe(modality);
      }
      const globalId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Farmer Carry', 'weight_reps', true)`, globalId);
      const fork = await app.inject({ method: "POST", url: `/v1/exercises/${globalId}/fork`, headers: JSON_A, payload: { modality: "weight_distance" } });
      expect(fork.statusCode).toBe(201);
      expect(fork.json().modality).toBe("weight_distance");
      const patched = await app.inject({ method: "PATCH", url: `/v1/exercises/${fork.json().id}`, headers: JSON_A, payload: { modality: "weight_duration" } });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().modality).toBe("weight_duration");
      const list = await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER_A });
      expect(list.statusCode).toBe(200);
      expect(JSON.stringify(list.json())).toContain("weight_duration");
    });
    it("a ninth value is 422; another user's new-type exercise is 404", async () => {
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
      expect((await create({ name: "Row", modality: "rowing" })).statusCode).toBe(422);
      await app.inject({ method: "GET", url: "/v1/me", headers: JSON_B });
      const theirs = await create({ name: "Their Bike", modality: "calories" }, JSON_B);
      const r = await app.inject({ method: "PATCH", url: `/v1/exercises/${theirs.json().id}`, headers: JSON_A, payload: { name: "Mine" } });
      expect(r.statusCode).toBe(404);
    });
  });

  describe("05.3 AC12 — routine targets and planned sets", () => {
    async function exerciseOf(modality: Modality) {
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
      return (await app.inject({ method: "POST", url: "/v1/exercises", headers: JSON_A, payload: { name: `R ${modality} ${uuidv7().slice(-4)}`, modality } })).json().id as string;
    }
    const createRoutine = (items: object[]) =>
      app.inject({ method: "POST", url: "/v1/routines", headers: JSON_A, payload: { name: `R ${uuidv7().slice(-6)}`, items } });
    it("weight_distance takes weight rows, refuses reps rows; start snapshots modality and planned rows", async () => {
      const ex = await exerciseOf("weight_distance");
      const ok = await createRoutine([{ exerciseId: ex, sets: [{ setType: "working", weight: 24, weightUnit: "kg" }] }]);
      expect(ok.statusCode).toBe(201);
      const bad = await createRoutine([{ exerciseId: ex, sets: [{ setType: "working", weight: 24, weightUnit: "kg", repsLow: 5, repsHigh: 5 }] }]);
      expect(bad.statusCode).toBe(422);
      expect(JSON.stringify(bad.json())).toContain("not allowed for this exercise type");
      const w = await app.inject({
        method: "POST", url: "/v1/workouts", headers: JSON_A,
        payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString(), routineId: ok.json().id },
      });
      expect(w.statusCode).toBe(201);
      const detail = await app.inject({ method: "GET", url: `/v1/workouts/${w.json().id}`, headers: BEARER_A });
      const card = detail.json().exercises[0];
      expect(card.modalitySnapshot).toBe("weight_distance");
      expect(card.plannedSets).toEqual([{ setType: "working", repsLow: null, repsHigh: null, weight: 24, weightUnit: "kg" }]);
    });
    it("calories takes set-type-only rows and refuses weight; quick-line reps are refused on all three", async () => {
      const cal = await exerciseOf("calories");
      expect((await createRoutine([{ exerciseId: cal, sets: [{ setType: "working" }] }])).statusCode).toBe(201);
      expect((await createRoutine([{ exerciseId: cal, sets: [{ setType: "working", weight: 10, weightUnit: "kg" }] }])).statusCode).toBe(422);
      for (const m of ["calories", "weight_distance", "weight_duration"] as const) {
        const ex = await exerciseOf(m);
        expect((await createRoutine([{ exerciseId: ex, targetRepsLow: 10 }])).statusCode, m).toBe(422);
        expect((await createRoutine([{ exerciseId: ex, targetSets: 3, restSeconds: 60 }])).statusCode, m).toBe(201);
      }
    });
  });

  describe("05.3 AC13 — snapshots", () => {
    it("an added calories card snapshots calories, and a later exercise PATCH leaves it", async () => {
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
      const ex = (await app.inject({ method: "POST", url: "/v1/exercises", headers: JSON_A, payload: { name: "Echo Bike", modality: "calories" } })).json().id;
      const w = await app.inject({ method: "POST", url: "/v1/workouts", headers: JSON_A, payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() } });
      const we = await app.inject({ method: "POST", url: `/v1/workouts/${w.json().id}/exercises`, headers: JSON_A, payload: { exerciseId: ex } });
      expect(we.json().modalitySnapshot).toBe("calories");
      await app.inject({ method: "PATCH", url: `/v1/exercises/${ex}`, headers: JSON_A, payload: { modality: "duration" } });
      const detail = await app.inject({ method: "GET", url: `/v1/workouts/${w.json().id}`, headers: BEARER_A });
      expect(detail.json().exercises[0].modalitySnapshot).toBe("calories");
    });
  });
});
