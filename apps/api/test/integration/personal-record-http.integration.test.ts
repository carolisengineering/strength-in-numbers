import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { PersonalRecordSchema } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, TRUNCATE_ALL } from "./records-helpers.js";

const JSON_A = { authorization: "Bearer pr-a", "content-type": "application/json" };
const JSON_B = { authorization: "Bearer pr-b", "content-type": "application/json" };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe.skipIf(!shouldRunIntegration())("Spec 07.0 — personal records over HTTP (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance | undefined;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  function makeApp(): Promise<FastifyInstance> {
    return buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => {
        if (token === "pr-a") return authContext({ authSub: "auth0|pr-a", email: "a@ex.com" });
        if (token === "pr-b") return authContext({ authSub: "auth0|pr-b", email: "b@ex.com" });
        throw new Error(`unexpected bearer token in test: ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      rateLimits: GENEROUS_LIMITS,
    });
  }

  /** Start → add one exercise → log sets → finish, all over HTTP. */
  async function session(
    headers: typeof JSON_A,
    exerciseId: string,
    sets: { reps: number; weight: number }[],
    startedHoursAgo: number,
  ) {
    const created = await app!.inject({
      method: "POST",
      url: "/v1/workouts",
      headers,
      payload: { clientGeneratedId: uuidv7(), startedAt: hoursAgo(startedHoursAgo) },
    });
    expect(created.statusCode).toBe(201);
    const workoutId = created.json().id as string;
    const we = await app!.inject({ method: "POST", url: `/v1/workouts/${workoutId}/exercises`, headers, payload: { exerciseId } });
    expect(we.statusCode).toBe(201);
    for (const s of sets) {
      const res = await app!.inject({
        method: "POST",
        url: `/v1/workout-exercises/${we.json().id}/sets`,
        headers,
        payload: { reps: s.reps, weight: s.weight, weightUnit: "kg", isComplete: true },
      });
      expect(res.statusCode).toBe(201);
    }
    const finish = await app!.inject({
      method: "PATCH",
      url: `/v1/workouts/${workoutId}`,
      headers,
      payload: { endedAt: hoursAgo(startedHoursAgo - 1) },
    });
    return { workoutId, finish };
  }

  const get = (headers: typeof JSON_A, query = "") =>
    app!.inject({ method: "GET", url: `/v1/personal-records${query}`, headers });
  const sortByType = <T extends { recordType: string }>(xs: T[]) =>
    [...xs].sort((a, b) => a.recordType.localeCompare(b.recordType));

  /** A: global G + forks F1, F2 + custom C, sessions on F1 then C. B: custom X, one session. */
  async function arrange() {
    app = await makeApp();
    const meA = await app.inject({ method: "GET", url: "/v1/me", headers: JSON_A });
    const meB = await app.inject({ method: "GET", url: "/v1/me", headers: JSON_B });
    const userA = meA.json().id as string;
    const userB = meB.json().id as string;
    const G = await insertExercise(db, { name: "Bench Press" });
    const F1 = await insertExercise(db, { ownerUserId: userA, forkedFrom: G, name: "My Bench" });
    const F2 = await insertExercise(db, { ownerUserId: userA, forkedFrom: G, name: "Paused Bench" });
    const C = await insertExercise(db, { ownerUserId: userA, name: "Landmine Press" });
    const X = await insertExercise(db, { ownerUserId: userB, name: "B only" });
    // B's own fork of G: resolving it for A would reveal "B forked G" (§7).
    const BFork = await insertExercise(db, { ownerUserId: userB, forkedFrom: G, name: "B's bench" });
    const onF1 = await session(JSON_A, F1, [{ reps: 5, weight: 100 }], 30);
    const onC = await session(JSON_A, C, [{ reps: 5, weight: 50 }], 20);
    const onX = await session(JSON_B, X, [{ reps: 5, weight: 70 }], 10);
    return { G, F1, F2, C, X, BFork, onF1, onC, onX };
  }

  describe("AC12/AC14 (HTTP) — finish carries newRecords; ?workoutId= recovers them", () => {
    it("finish → 200 with three schema-valid records; repeat → 409; GET ?workoutId= returns the same", async () => {
      const { onF1 } = await arrange();
      expect(onF1.finish.statusCode).toBe(200);
      const newRecords = onF1.finish.json().newRecords as unknown[];
      expect(newRecords).toHaveLength(3);
      for (const r of newRecords) PersonalRecordSchema.parse(r);

      const again = await app!.inject({
        method: "PATCH",
        url: `/v1/workouts/${onF1.workoutId}`,
        headers: JSON_A,
        payload: { endedAt: hoursAgo(1) },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().type).toMatch(/workout-finished$/);

      const recovered = await get(JSON_A, `?workoutId=${onF1.workoutId}`);
      expect(sortByType(recovered.json().records)).toEqual(sortByType(onF1.finish.json().newRecords));
    });
  });

  describe("AC19 — filters and lineage resolution", () => {
    it("no params: all of A's rows, newest first", async () => {
      const { G, C, onC } = await arrange();
      const records = (await get(JSON_A)).json().records as { exerciseId: string; workoutId: string }[];
      expect(records).toHaveLength(6);
      expect(new Set(records.map((r) => r.exerciseId))).toEqual(new Set([G, C]));
      expect(records[0]!.workoutId).toBe(onC.workoutId); // C's session started later
    });

    it("origin id, fork id and second fork id return identical bodies; the root is G, the label is F1's", async () => {
      const { G, F1, F2 } = await arrange();
      const byG = await get(JSON_A, `?exerciseId=${G}`);
      const byF1 = await get(JSON_A, `?exerciseId=${F1}`);
      const byF2 = await get(JSON_A, `?exerciseId=${F2}`);
      expect(byF1.body).toBe(byG.body);
      expect(byF2.body).toBe(byG.body);
      const records = byG.json().records as { exerciseId: string; sourceExerciseId: string; exerciseName: string }[];
      expect(records).toHaveLength(3);
      // exerciseName is the source row's snapshot (F1's name when added), not G's.
      expect(records.every((r) => r.exerciseId === G && r.sourceExerciseId === F1 && r.exerciseName === "My Bench")).toBe(true);
    });

    it("both filters intersect", async () => {
      const { G, onC } = await arrange();
      expect((await get(JSON_A, `?exerciseId=${G}&workoutId=${onC.workoutId}`)).json().records).toEqual([]);
    });
  });

  describe("AC20 — no existence oracle, no cross-user read", () => {
    it("foreign, absent and unseen ids all answer 200 with an identical empty body", async () => {
      const { X, BFork, onX } = await arrange();
      const bodies: string[] = [];
      // BFork is the case that needs the visibility clause: A HAS rows on its
      // root G, so only the owner check keeps A from learning B forked G.
      for (const q of [
        `?exerciseId=${X}`,
        `?exerciseId=${BFork}`,
        `?exerciseId=${uuidv7()}`,
        `?workoutId=${onX.workoutId}`,
        `?workoutId=${uuidv7()}`,
      ]) {
        const res = await get(JSON_A, q);
        expect(res.statusCode).toBe(200);
        bodies.push(res.body);
      }
      expect(new Set(bodies)).toEqual(new Set(['{"records":[]}']));
    });

    it("B never sees A's rows", async () => {
      const { onF1, onC, onX } = await arrange();
      const records = (await get(JSON_B)).json().records as { workoutId: string }[];
      expect(records).toHaveLength(3);
      expect(records.every((r) => r.workoutId === onX.workoutId)).toBe(true);
      expect(records.some((r) => r.workoutId === onF1.workoutId || r.workoutId === onC.workoutId)).toBe(false);
    });
  });

  describe("Review Focus 5 — a retired own custom exercise keeps its records", () => {
    it("after DELETE /v1/exercises/C, ?exerciseId=C still returns C's rows", async () => {
      const { C } = await arrange();
      const del = await app!.inject({ method: "DELETE", url: `/v1/exercises/${C}`, headers: JSON_A });
      expect(del.statusCode).toBe(204);
      const records = (await get(JSON_A, `?exerciseId=${C}`)).json().records as unknown[];
      expect(records).toHaveLength(3);
    });
  });
});
