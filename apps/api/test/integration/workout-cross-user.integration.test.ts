import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { NotFoundError } from "../../src/errors/app-error.js";
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

describe.skipIf(!shouldRunIntegration())("AC15 — cross-user 404 and the vanished-row rule (real Postgres)", () => {
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
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
    );
    return id;
  }

  /**
   * A real app (`buildApp`), real repositories against the Testcontainers
   * Postgres, and a token verifier that maps two fixed bearer tokens to two
   * distinct (self-provisioning) auth subs — the same shape
   * `foundation.integration.test.ts` uses, just with two identities instead
   * of one so both users can be driven through the same `fastify.inject`
   * app instance.
   */
  function appFor(): Promise<FastifyInstance> {
    return buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => {
        if (token === TOKEN_A) {
          return authContext({ authSub: "auth0|cross-user-a", email: "a@ex.com" });
        }
        if (token === TOKEN_B) {
          return authContext({ authSub: "auth0|cross-user-b", email: "b@ex.com" });
        }
        throw new Error(`unexpected bearer token in test: ${token}`);
      }),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
    });
  }

  it("all six id-taking routes: user B's row and a malformed id both produce field-identical problem+json 404s (only instance differs), no route ever answers 403; plus the add-exercise body case", async () => {
    const app = await appFor();

    // Provision both users (self-provisioning on first authenticated request —
    // Spec 01 §6.2) and capture B's real user id for the custom-exercise setup
    // below.
    await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_A });
    const meB = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER_B });
    expect(meB.statusCode).toBe(200);
    const userBId = meB.json().id as string;

    const globalExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Shared', 'weight_reps', true)`,
      globalExerciseId,
    );
    // User B's own custom exercise — not visible to A either (the add-exercise
    // body case below).
    const customExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'B custom', 'weight_reps', true)`,
      customExerciseId,
      userBId,
    );

    // User B's real workout + workout-exercise, created entirely over HTTP.
    const createB = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: JSON_B,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() },
    });
    expect(createB.statusCode).toBe(201);
    const bWorkoutId = createB.json().id as string;

    const addB = await app.inject({
      method: "POST",
      url: `/v1/workouts/${bWorkoutId}/exercises`,
      headers: JSON_B,
      payload: { exerciseId: globalExerciseId },
    });
    expect(addB.statusCode).toBe(201);
    const bWorkoutExerciseId = addB.json().id as string;

    // User A's own workout, used only for the add-exercise body case below
    // (A needs a workout of her own to POST against).
    const createA = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: JSON_A,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString() },
    });
    expect(createA.statusCode).toBe(201);
    const aWorkoutId = createA.json().id as string;

    interface InjectSpec {
      method: "GET" | "POST" | "PATCH" | "DELETE";
      url: string;
      headers: Record<string, string>;
      payload?: Record<string, unknown>;
    }

    interface RouteCase {
      name: string;
      /** User B's real, existing row id for this route. */
      realId: string;
      request: (id: string) => InjectSpec;
    }

    // All six id-taking routes (Spec 05.0 §5, AC15).
    const routes: RouteCase[] = [
      {
        name: "GET /v1/workouts/{id}",
        realId: bWorkoutId,
        request: (id) => ({ method: "GET", url: `/v1/workouts/${id}`, headers: BEARER_A }),
      },
      {
        name: "PATCH /v1/workouts/{id}",
        realId: bWorkoutId,
        request: (id) => ({ method: "PATCH", url: `/v1/workouts/${id}`, headers: JSON_A, payload: {} }),
      },
      {
        name: "DELETE /v1/workouts/{id}",
        realId: bWorkoutId,
        request: (id) => ({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER_A }),
      },
      {
        name: "POST /v1/workouts/{id}/exercises",
        realId: bWorkoutId,
        request: (id) => ({
          method: "POST",
          url: `/v1/workouts/${id}/exercises`,
          headers: JSON_A,
          payload: { exerciseId: globalExerciseId },
        }),
      },
      {
        name: "PATCH /v1/workout-exercises/{id}",
        realId: bWorkoutExerciseId,
        request: (id) => ({ method: "PATCH", url: `/v1/workout-exercises/${id}`, headers: JSON_A, payload: {} }),
      },
      {
        name: "DELETE /v1/workout-exercises/{id}",
        realId: bWorkoutExerciseId,
        request: (id) => ({ method: "DELETE", url: `/v1/workout-exercises/${id}`, headers: BEARER_A }),
      },
    ];

    for (const route of routes) {
      const realRes = await app.inject(route.request(route.realId));
      const malformedRes = await app.inject(route.request(MALFORMED_ID));

      expect(realRes.statusCode, `${route.name} vs. user B's row`).toBe(404);
      expect(malformedRes.statusCode, `${route.name} vs. a malformed id`).toBe(404);
      // The central claim of AC15: cross-user-owned-row and malformed-id are
      // indistinguishable to the caller — neither ever leaks existence via a
      // 403.
      expect(realRes.statusCode).not.toBe(403);
      expect(malformedRes.statusCode).not.toBe(403);

      const realBody = realRes.json();
      const malformedBody = malformedRes.json();
      for (const field of ["type", "title", "status", "detail"] as const) {
        expect(realBody[field], `${route.name}: ${field}`).toEqual(malformedBody[field]);
      }
      // `instance` legitimately differs — it's per-request (Spec 01 §5's
      // request id, echoed onto every problem+json body), not the URI, so two
      // distinct requests always carry two distinct instances regardless of
      // which 404 branch produced them.
      expect(realBody.instance).not.toBe(malformedBody.instance);
    }

    // The add-exercise body case: user B's own custom exerciseId, submitted by
    // user A in the request body (not the URL) -> 404, never 403.
    const bodyCase = await app.inject({
      method: "POST",
      url: `/v1/workouts/${aWorkoutId}/exercises`,
      headers: JSON_A,
      payload: { exerciseId: customExerciseId },
    });
    expect(bodyCase.statusCode).toBe(404);
    expect(bodyCase.statusCode).not.toBe(403);
  });

  /**
   * Vanished-row races (repository level — these exercise the transaction/lock
   * mechanics directly, not the HTTP layer, which AC15's field-identity claim
   * above already covers at the wire).
   *
   * `deleteWorkout` issues exactly two round trips (an ownership SELECT, then a
   * bare `DELETE`) and holds no lock across them. `addWorkoutExercise` (and
   * `updateWorkoutExercise`'s reorder path) cannot even reach the vanished-row
   * check without first completing two of its own round trips (an ownership
   * SELECT, then — for add — the exercise lookup) and then opening a
   * transaction that itself issues several further statements (`SET
   * CONSTRAINTS`, the advisory lock, the `FOR SHARE`/`FOR UPDATE` re-check)
   * before it ever touches the row the delete is racing to remove.
   *
   * Because both calls are kicked off synchronously in the same tick (`delete`
   * listed first, matching the call order below) and Postgres/Prisma give the
   * two-round-trip delete very little room to fall behind the multi-statement
   * add/reorder transaction, the delete's commit lands first on almost every
   * run — verified empirically before writing this test at 25/25 in isolation
   * for both races. Run alongside the rest of this suite's own Testcontainers
   * load, a single iteration can occasionally flip (observed once in ~10 runs
   * under full-suite contention), the same load-timing sensitivity already
   * called out in `workout-finish-concurrency.integration.test.ts`. So rather
   * than assert every iteration hits the vanished-row branch (flaky under that
   * contention) or only assert a one-shot conditional (proves nothing if the
   * branch never fires), each test below repeats the race `RACE_ITERATIONS`
   * times and requires the vanished-row branch to fire on a clear majority —
   * enough to fail if a real regression stopped the branch from ever
   * occurring, without depending on every single run being contention-free.
   * Every iteration, regardless of which branch fires, is still checked for
   * the one invariant that always holds: the delete always succeeds, and a
   * losing add/reorder is always `NotFoundError`, never an unmapped 23503 or
   * a 500-shaped error.
   */
  const RACE_ITERATIONS = 20;
  const RACE_MIN_VANISHED_ROW_HITS = RACE_ITERATIONS * 0.6;

  it("a workout deleted between the handler's read and the add-exercise transaction's lock is reliably 404, never 500", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'X', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

    let vanishedRowHits = 0;
    for (let i = 0; i < RACE_ITERATIONS; i += 1) {
      const { workout } = await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      const [deleteResult, addResult] = await Promise.allSettled([
        repo.deleteWorkout(userId, workout.id),
        repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
      ]);

      expect(deleteResult.status, `iteration ${i}`).toBe("fulfilled");
      if (addResult.status === "rejected") {
        expect(addResult.reason).toBeInstanceOf(NotFoundError);
        vanishedRowHits += 1;
      }
      // Whichever order won, no 23503 / 500 occurred — `Promise.allSettled`
      // would not have resolved "rejected" with anything else, since the
      // repository maps every DB-layer failure on this path to
      // `NotFoundError` or `WorkoutFinishedError`, never lets a raw driver
      // error through.
    }

    expect(
      vanishedRowHits,
      `the vanished-row branch must fire on a clear majority of ${RACE_ITERATIONS} runs, not just occasionally`,
    ).toBeGreaterThanOrEqual(RACE_MIN_VANISHED_ROW_HITS);

    const remaining = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE exercise_id = $1::uuid`,
      exerciseId,
    );
    // No add ever landed a row against a workout whose delete had already
    // committed — never a leaked 23503, never an orphaned insert.
    expect(Number(remaining[0]!.n)).toBe(0);
  });

  it("a workout deleted between the handler's read and a workout-exercise reorder transaction's lock is reliably 404, never 500", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'X', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

    let vanishedRowHits = 0;
    for (let i = 0; i < RACE_ITERATIONS; i += 1) {
      const { workout } = await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );
      const we = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

      const [deleteResult, reorderResult] = await Promise.allSettled([
        repo.deleteWorkout(userId, workout.id),
        repo.updateWorkoutExercise(userId, we.id, { position: 0 }),
      ]);

      expect(deleteResult.status, `iteration ${i}`).toBe("fulfilled");
      if (reorderResult.status === "rejected") {
        expect(reorderResult.reason).toBeInstanceOf(NotFoundError);
        vanishedRowHits += 1;
      }
      // No raw 23503 FK-violation or unmapped error surfaced either way.
    }

    expect(
      vanishedRowHits,
      `the vanished-row branch must fire on a clear majority of ${RACE_ITERATIONS} runs, not just occasionally`,
    ).toBeGreaterThanOrEqual(RACE_MIN_VANISHED_ROW_HITS);
  });
});
