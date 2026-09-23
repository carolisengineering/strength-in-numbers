import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { NotFoundError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

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

  it("every id-taking method returns NotFoundError (never leaks) for another user's row and for a malformed id", async () => {
    const userA = await insertUser();
    const userB = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repoA = createWorkoutRepository(db.prisma, exerciseRepo);
    const repoB = createWorkoutRepository(db.prisma, exerciseRepo);

    const { workout: bWorkout } = await repoB.createWorkout(
      userB,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Shared', 'weight_reps', true)`,
      exerciseId,
    );
    const bWe = await repoB.addWorkoutExercise(userB, bWorkout.id, { exerciseId });

    for (const id of [bWorkout.id, "not-a-uuid"]) {
      await expect(repoA.getWorkoutById(userA, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.updateWorkout(userA, id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.deleteWorkout(userA, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        repoA.addWorkoutExercise(userA, id, { exerciseId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const id of [bWe.id, "not-a-uuid"]) {
      await expect(repoA.updateWorkoutExercise(userA, id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.deleteWorkoutExercise(userA, id)).rejects.toBeInstanceOf(NotFoundError);
    }

    // Own-user custom exercise not visible to A either.
    const customExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'B custom', 'weight_reps', true)`,
      customExerciseId,
      userB,
    );
    const { workout: aWorkout } = await repoA.createWorkout(
      userA,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await expect(
      repoA.addWorkoutExercise(userA, aWorkout.id, { exerciseId: customExerciseId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a workout deleted between the handler's read and the position transaction's lock is 404, not 500", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'X', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const [deleteResult, addResult] = await Promise.allSettled([
      repo.deleteWorkout(userId, workout.id),
      repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
    ]);

    expect(deleteResult.status).toBe("fulfilled");
    if (addResult.status === "rejected") {
      expect(addResult.reason).toBeInstanceOf(NotFoundError);
    }
    // Whichever order won, no 23503 / 500 occurred — Promise.allSettled would
    // not have resolved "rejected" with anything else, since the repository
    // maps every DB-layer failure on this path to NotFoundError or
    // WorkoutFinishedError, never lets a raw driver error through.
  });

  it("a workout deleted between the handler's read and a workout-exercise reorder transaction's lock is 404, not 500", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'X', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const we = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

    const [deleteResult, reorderResult] = await Promise.allSettled([
      repo.deleteWorkout(userId, workout.id),
      repo.updateWorkoutExercise(userId, we.id, { position: 5 }),
    ]);

    expect(deleteResult.status).toBe("fulfilled");
    if (reorderResult.status === "rejected") {
      expect(reorderResult.reason).toBeInstanceOf(NotFoundError);
    }
    // No raw 23503 FK-violation or unmapped error surfaced either way.
  });
});
