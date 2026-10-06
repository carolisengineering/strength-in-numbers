import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

const TOKEN_A = "cross-user-a-token";
const TOKEN_B = "cross-user-b-token";
const BEARER_A = { authorization: `Bearer ${TOKEN_A}` };
const BEARER_B = { authorization: `Bearer ${TOKEN_B}` };
const JSON_A = { ...BEARER_A, "content-type": "application/json" };
const JSON_B = { ...BEARER_B, "content-type": "application/json" };
const MALFORMED_ID = "not-a-uuid";

/**
 * Spec 05.1 AC4 (cross-user 404, never 403, on all three set routes) and
 * AC15 (an account purge reaches set_entry through workout → workout_exercise
 * with no ordering step), over a real app and real repositories — the same
 * two-identity shape as workout-cross-user.integration.test.ts.
 */
describe.skipIf(!shouldRunIntegration())("Spec 05.1 cross-user 404s and account purge (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe('TRUNCATE "set_entry", "workout", "workout_exercise", "exercise", "user" CASCADE');
  });

  function appFor(): Promise<FastifyInstance> {
    return buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => {
        if (token === TOKEN_A) return authContext({ authSub: "auth0|cross-user-a", email: "a@ex.com" });
        if (token === TOKEN_B) return authContext({ authSub: "auth0|cross-user-b", email: "b@ex.com" });
        throw new Error(`unexpected bearer token in test: ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
    });
  }

  // `instance` is the only field allowed to differ; toEqual ignores undefined props.
  const strip = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

  it("AC4 — B's set, B's workout_exercise and a malformed id give field-identical 404s on all three routes; never 403", async () => {
    const app = await appFor();
    await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
    await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_B });
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Shared', 'bodyweight_reps', true)`,
      exerciseId,
    );
    const w = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: JSON_B,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() },
    });
    const we = await app.inject({
      method: "POST",
      url: `/v1/workouts/${w.json().id}/exercises`,
      headers: JSON_B,
      payload: { exerciseId },
    });
    const set = await app.inject({
      method: "POST",
      url: `/v1/workout-exercises/${we.json().id}/sets`,
      headers: JSON_B,
      payload: { reps: 5 },
    });
    expect(set.statusCode).toBe(201);

    const cases: [string, string, string, object | undefined][] = [
      ["POST", `/v1/workout-exercises/${we.json().id}/sets`, `/v1/workout-exercises/${MALFORMED_ID}/sets`, {}],
      ["PATCH", `/v1/sets/${set.json().id}`, `/v1/sets/${MALFORMED_ID}`, { reps: 6 }],
      ["DELETE", `/v1/sets/${set.json().id}`, `/v1/sets/${MALFORMED_ID}`, undefined],
    ];
    for (const [method, bUrl, badUrl, payload] of cases) {
      const headers = payload ? JSON_A : BEARER_A;
      const asA = await app.inject({ method: method as "POST", url: bUrl, headers, payload });
      const malformed = await app.inject({ method: method as "POST", url: badUrl, headers, payload });
      expect(asA.statusCode, `${method} ${bUrl}`).toBe(404);
      expect(malformed.statusCode, `${method} ${badUrl}`).toBe(404);
      expect(strip(asA.json())).toEqual(strip(malformed.json()));
    }
    // B's set is untouched by A's attempts.
    const still = await app.inject({ method: "GET", url: `/v1/workouts/${w.json().id}`, headers: BEARER_B });
    expect(still.json().exercises[0].sets).toHaveLength(1);
    expect(still.json().exercises[0].sets[0].reps).toBe(5);
  });

  it("AC15 — DELETE FROM user reaches set_entry through workout → workout_exercise in one statement", async () => {
    const app = await appFor();
    const meA = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
    await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_B });
    const globalId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Global', 'bodyweight_reps', true)`,
      globalId,
    );
    const customId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'A custom', 'bodyweight_reps', true)`,
      customId,
      meA.json().id,
    );
    const plans: [Record<string, string>, string[]][] = [
      [JSON_A, [globalId, customId]],
      [JSON_B, [globalId]],
    ];
    for (const [headers, exercises] of plans) {
      const w = await app.inject({
        method: "POST",
        url: "/v1/workouts",
        headers,
        payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() },
      });
      for (const exerciseId of exercises) {
        const we = await app.inject({
          method: "POST",
          url: `/v1/workouts/${w.json().id}/exercises`,
          headers,
          payload: { exerciseId },
        });
        const s = await app.inject({
          method: "POST",
          url: `/v1/workout-exercises/${we.json().id}/sets`,
          headers,
          payload: { reps: 5 },
        });
        expect(s.statusCode).toBe(201);
      }
    }
    const count = async () =>
      Number((await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "set_entry"`))[0]!.n);
    expect(await count()).toBe(3);

    await db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, meA.json().id);

    expect(await count()).toBe(1); // only B's set survives
    const global = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "exercise" WHERE id = $1::uuid`,
      globalId,
    );
    expect(Number(global[0]!.n)).toBe(1);
  });
});
