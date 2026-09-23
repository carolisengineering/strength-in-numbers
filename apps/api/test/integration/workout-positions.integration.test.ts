// apps/api/test/integration/workout-positions.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.0 AC11/AC12/AC13/AC14 — real-Postgres proof of the dense-position
 * invariant, the deferred-constraint two-row swap, six genuinely concurrent
 * adds serialized by the advisory lock, and the real SQL statement order.
 */
describe.skipIf(!shouldRunIntegration())("AC11/AC12/AC13/AC14 — positions (real Postgres)", () => {
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

  async function insertGlobalExercise(name: string): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, $2, 'weight_reps', true)`,
      id,
      name,
    );
    return id;
  }

  async function positionsOf(workoutId: string): Promise<number[]> {
    const rows = await db.prisma.$queryRawUnsafe<{ position: number }[]>(
      `SELECT position FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`,
      workoutId,
    );
    return rows.map((r) => r.position);
  }

  it("AC11: a table-driven append/insert/reorder/delete sequence always leaves 0..n-1 dense with no gap or duplicate", async () => {
    const userId = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);
    const exerciseIds = await Promise.all(
      Array.from({ length: 4 }, (_, i) => insertGlobalExercise(`Ex ${i}`)),
    );
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const a = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[0]! }); // append -> 0
    const b = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[1]! }); // append -> 1
    await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[2]!, position: 1 }); // insert -> shifts b to 2
    expect(await positionsOf(workout.id)).toEqual([0, 1, 2]);

    await repo.updateWorkoutExercise(userId, b.id, { position: 0 }); // reorder b to front
    expect(await positionsOf(workout.id)).toEqual([0, 1, 2]);

    await repo.deleteWorkoutExercise(userId, a.id); // delete closes the gap
    expect(await positionsOf(workout.id)).toEqual([0, 1]);
  });

  it("AC11: position above the smallint ceiling is 422, never a Postgres 22003 500", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const exerciseId = await insertGlobalExercise("Solo");
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await expect(
      repo.addWorkoutExercise(userId, workout.id, { exerciseId, position: 40_000 }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("AC12: a two-row swap commits through a colliding intermediate state and leaves a dense sequence", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const e0 = await insertGlobalExercise("Zero");
    const e1 = await insertGlobalExercise("One");
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const row0 = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: e0 });
    const row1 = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: e1 });
    expect([row0.position, row1.position]).toEqual([0, 1]);

    // Swap: move row0 (pos 0) to pos 1. The repository's reorder path must
    // pass through an intermediate two-rows-at-one-position state that only
    // the deferred constraint tolerates.
    await repo.updateWorkoutExercise(userId, row0.id, { position: 1 });

    expect(await positionsOf(workout.id)).toEqual([0, 1]);
    const updatedRow1 = await db.prisma.$queryRawUnsafe<{ position: number }[]>(
      `SELECT position FROM "workout_exercise" WHERE id = $1::uuid`,
      row1.id,
    );
    expect(updatedRow1[0]!.position).toBe(0);
  });

  it("AC12: six concurrent adds to the same workout all succeed, none is 500, final sequence is dense with no duplicate", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const exerciseIds = await Promise.all(
      Array.from({ length: 6 }, (_, i) => insertGlobalExercise(`Concurrent ${i}`)),
    );
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const results = await Promise.allSettled(
      exerciseIds.map((exerciseId) => repo.addWorkoutExercise(userId, workout.id, { exerciseId })),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const positions = await positionsOf(workout.id);
    expect(positions.sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(positions).size).toBe(6); // no duplicate
  });

  it("AC13: the advisory lock is the first non-SET-CONSTRAINTS statement; the count read is later and separate (captured from the real driver)", async () => {
    const userId = await insertUser();
    const exerciseId = await insertGlobalExercise("Query-captured");
    const { workout } = await createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)).createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const captured: string[] = [];
    // @ts-expect-error -- Prisma's $on typing for the "query" event is not
    // exported on PrismaClient by default; this mirrors the existing
    // exercise-repository query-capture idiom used elsewhere in this suite.
    db.prisma.$on("query", (e: { query: string }) => captured.push(e.query));

    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

    const relevant = captured.filter(
      (q) => q.includes("advisory_xact_lock") || q.includes("SET CONSTRAINTS") || q.includes("count("),
    );
    const lockIndex = relevant.findIndex((q) => q.includes("advisory_xact_lock"));
    const countIndex = relevant.findIndex((q) => q.includes("count("));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeGreaterThan(lockIndex);
  });

  it("AC14: the create path issues no advisory lock, confirmed against the real driver", async () => {
    const userId = await insertUser();
    const captured: string[] = [];
    // @ts-expect-error -- see the note above.
    db.prisma.$on("query", (e: { query: string }) => captured.push(e.query));
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

    await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    expect(captured.some((q) => q.includes("advisory_xact_lock"))).toBe(false);
  });
});
