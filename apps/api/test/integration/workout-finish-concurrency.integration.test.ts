import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.0 AC8/AC9 — the finish transaction's `FOR UPDATE` lock (on
 * `updateWorkout`) and `addWorkoutExercise`'s `FOR SHARE` re-check (Task 12)
 * actually serialize concurrent finish-vs-write races against real Postgres,
 * not the scripted mock outcome-switch Task 10's/12's unit tests exercised.
 * Whichever side commits second sees the other's already-committed state and
 * either proceeds consistently or is rejected with a 409 — a genuinely
 * finished workout never silently accepts a write, and no
 * workout_exercise row is ever created after its parent's ended_at was
 * committed.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC9 — finish vs. add-exercise race (FOR SHARE re-check, real Postgres)",
  () => {
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

    async function insertGlobalExercise(): Promise<string> {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Bench', 'weight_reps', true)`,
        id,
      );
      return id;
    }

    it("a concurrent finish and add-exercise never leaves a workout_exercise row created after its parent's ended_at was committed", async () => {
      const userId = await insertUser();
      const exerciseId = await insertGlobalExercise();
      const exerciseRepo = createExerciseRepository(db.prisma);
      const repo = createWorkoutRepository(db.prisma, exerciseRepo);
      const { workout } = await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      const [finishResult, addResult] = await Promise.allSettled([
        repo.updateWorkout(userId, workout.id, { endedAt: new Date().toISOString() }),
        repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
      ]);

      expect(finishResult.status).toBe("fulfilled");
      if (finishResult.status !== "fulfilled") {
        throw new Error("unreachable: asserted fulfilled above");
      }
      if (addResult.status === "rejected") {
        expect(addResult.reason).toBeInstanceOf(WorkoutFinishedError);
        const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
          workout.id,
        );
        expect(Number(rows[0]!.n)).toBe(0);
      } else {
        const finishedAt = finishResult.value.endedAt!;
        const addedAtRows = await db.prisma.$queryRawUnsafe<{ created_at: Date }[]>(
          `SELECT created_at FROM "workout_exercise" WHERE id = $1::uuid`,
          addResult.value.id,
        );
        expect(addedAtRows[0]!.created_at.getTime()).toBeLessThanOrEqual(finishedAt.getTime());
      }
    });

    it("AC8 — 10 concurrent finish attempts on the same workout: the FOR UPDATE lock serializes them, none silently double-applies", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
      const { workout } = await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          repo.updateWorkout(userId, workout.id, { endedAt: new Date().toISOString() }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // Exactly one call observes the row still in-progress (ended_at IS
      // NULL) under its FOR UPDATE lock and finishes it; every other call
      // acquires the lock afterwards, re-reads the now-committed ended_at,
      // and is rejected -- never a silent double-finish.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WorkoutFinishedError);
      }

      const rows = await db.prisma.$queryRawUnsafe<{ ended_at: Date | null }[]>(
        `SELECT ended_at FROM "workout" WHERE id = $1::uuid`,
        workout.id,
      );
      expect(rows[0]!.ended_at).not.toBeNull();
    });
  },
);
