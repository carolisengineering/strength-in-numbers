import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { ExerciseRetiredError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.0 AC10 — `exercise_name_snapshot`/`modality_snapshot` are captured
 * at insert time from the exercise row as it stood then, and are unaffected
 * by a later rename or soft-delete of the source exercise row (Spec 03.1).
 * This needs both `exerciseRepository` and `workoutRepository` against a
 * real Postgres, since it touches Spec 03.1's exercise table directly.
 */
describe.skipIf(!shouldRunIntegration())("AC10 — add-exercise snapshotting (real Postgres)", () => {
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

  it("a later rename or soft-delete of the exercise leaves the snapshot unchanged", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Original Name', 'weight_reps', true)`,
      exerciseId,
    );
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const added = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });
    expect(added.exerciseNameSnapshot).toBe("Original Name");

    await db.prisma.$executeRawUnsafe(
      `UPDATE "exercise" SET name = 'Renamed', is_active = false WHERE id = $1::uuid`,
      exerciseId,
    );

    const detail = await repo.getWorkoutById(userId, workout.id);
    expect(detail.exercises[0]!.exerciseNameSnapshot).toBe("Original Name");
  });

  it("adding the same exerciseId twice creates a second row at a distinct position", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Squat', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const first = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });
    const second = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

    expect(first.id).not.toBe(second.id);
    expect([first.position, second.position].sort()).toEqual([0, 1]);
  });

  it("adding a retired (is_active=false) exercise is rejected with ExerciseRetiredError and no snapshot is created", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Dead Lift', 'weight_reps', false)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    await expect(
      repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
    ).rejects.toBeInstanceOf(ExerciseRetiredError);

    const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      workout.id,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
