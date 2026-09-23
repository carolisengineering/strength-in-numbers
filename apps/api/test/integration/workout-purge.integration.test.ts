import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC17 — account purge reaches workout rows down both FK paths (real Postgres)", () => {
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

  it("DELETE FROM user removes the purged user's workout + workout_exercise rows down both paths, leaves the global exercise and the other user untouched", async () => {
    const purgedUser = await insertUser();
    const otherUser = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);

    const globalExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Global', 'weight_reps', true)`,
      globalExerciseId,
    );
    const customExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'Purged users own', 'weight_reps', true)`,
      customExerciseId,
      purgedUser,
    );

    const { workout: purgedWorkout } = await repo.createWorkout(
      purgedUser,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await repo.addWorkoutExercise(purgedUser, purgedWorkout.id, { exerciseId: globalExerciseId });
    await repo.addWorkoutExercise(purgedUser, purgedWorkout.id, { exerciseId: customExerciseId });

    const { workout: otherWorkout } = await repo.createWorkout(
      otherUser,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await repo.addWorkoutExercise(otherUser, otherWorkout.id, { exerciseId: globalExerciseId });

    await db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, purgedUser);

    const purgedUserWorkouts = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid`,
      purgedUser,
    );
    expect(Number(purgedUserWorkouts[0]!.n)).toBe(0);

    const purgedWorkoutExercises = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      purgedWorkout.id,
    );
    expect(Number(purgedWorkoutExercises[0]!.n)).toBe(0); // both FK paths cascaded

    const purgedCustomExerciseSurvives = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "exercise" WHERE id = $1::uuid`,
      customExerciseId,
    );
    expect(Number(purgedCustomExerciseSurvives[0]!.n)).toBe(0); // exercise->user cascade too

    const globalExerciseSurvives = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "exercise" WHERE id = $1::uuid`,
      globalExerciseId,
    );
    expect(Number(globalExerciseSurvives[0]!.n)).toBe(1);

    const otherUserWorkoutExercises = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      otherWorkout.id,
    );
    expect(Number(otherUserWorkoutExercises[0]!.n)).toBe(1); // untouched

    const otherUserSurvives = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "user" WHERE id = $1::uuid`,
      otherUser,
    );
    expect(Number(otherUserSurvives[0]!.n)).toBe(1);
  });
});
