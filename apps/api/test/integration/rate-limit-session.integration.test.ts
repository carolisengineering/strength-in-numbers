import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { RATE_LIMITS } from "../../src/plugins/rate-limit.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.2 AC15 — the production limits must never touch a real lifter: a
 * whole session, with the outbox's back-to-back set replay, against real
 * Postgres latency.
 */
const JSON_H = { authorization: "Bearer t", "content-type": "application/json" };

describe.skipIf(!shouldRunIntegration())("Spec 05.2 AC15 — a real session never trips a limit (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|ac15", email: "ac15@ex.com" })),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      rateLimits: RATE_LIMITS, // production values, on purpose
    });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it("AC15 — start, 6 add-exercise, 60 back-to-back set creates, finish: no 429", async () => {
    const statuses: number[] = [];
    const send = async (method: "POST" | "PATCH", url: string, payload: object) => {
      const res = await app.inject({ method, url, headers: JSON_H, payload });
      statuses.push(res.statusCode);
      return res;
    };
    await app.inject({ method: "GET", url: "/v1/me", headers: JSON_H });
    const exerciseIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, $2, 'bodyweight_reps', true)`,
        id,
        `AC15 ${i}`,
      );
      exerciseIds.push(id);
    }
    const w = await send("POST", "/v1/workouts", {
      clientGeneratedId: uuidv7(),
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const weIds: string[] = [];
    for (const exerciseId of exerciseIds) {
      weIds.push((await send("POST", `/v1/workouts/${w.json().id}/exercises`, { exerciseId })).json().id);
    }
    for (let i = 0; i < 60; i += 1) {
      await send("POST", `/v1/workout-exercises/${weIds[i % 6]}/sets`, {
        clientGeneratedId: uuidv7(),
        reps: 5,
        isComplete: true,
      });
    }
    await send("PATCH", `/v1/workouts/${w.json().id}`, { endedAt: new Date().toISOString() });

    expect(statuses).toHaveLength(68);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
    expect(statuses.every((s) => s >= 200 && s < 300)).toBe(true);
  });
});
