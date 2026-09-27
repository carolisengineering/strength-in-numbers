import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { Modality } from "@sin/core";
import { IncompleteWorkingSetsError, NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import type { CreateSetResult, UpdateWorkoutResult, WorkoutRepository } from "../../src/repositories/workout.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.1 AC10 / AC11 / AC21 / D10 — the set write paths' locks against
 * real Postgres. Races are repeated a few rounds so either interleaving can
 * show up; every round must land in one of the documented outcomes.
 */
describe.skipIf(!shouldRunIntegration())("Spec 05.1 set concurrency (real Postgres)", () => {
  let db: IntegrationDb;
  let repo: WorkoutRepository;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe('TRUNCATE "set_entry", "workout", "workout_exercise", "exercise", "user" CASCADE');
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, 'u@ex.com')`,
      id,
      `auth0|${id}`,
    );
    return id;
  }
  async function insertExercise(modality: Modality): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, $2, $3, true)`,
      id,
      `Ex ${id.slice(-6)}`,
      modality,
    );
    return id;
  }
  async function workoutWith(...modalities: Modality[]) {
    const userId = await insertUser();
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date(Date.now() - 3_600_000),
        tzOffsetMinutes: 0,
        title: null,
        notes: null,
      },
      "UTC",
    );
    const weIds: string[] = [];
    for (const m of modalities) {
      weIds.push((await repo.addWorkoutExercise(userId, workout.id, { exerciseId: await insertExercise(m) })).id);
    }
    return { userId, workoutId: workout.id, weIds };
  }
  const finish = (userId: string, workoutId: string) =>
    repo.updateWorkout(userId, workoutId, { endedAt: new Date().toISOString() });

  it("AC10 — six concurrent creates on one workout_exercise: six 201s, setNumbers {1..6}", async () => {
    const { userId, weIds } = await workoutWith("bodyweight_reps");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => repo.createSet(userId, weIds[0]!, { reps: 5 })),
    );
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.map((r) => String(r.reason))).toEqual([]);
    const numbers = results.map((r) => (r as PromiseFulfilledResult<CreateSetResult>).value.set.setNumber);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("AC11 — a concurrent finish and create: the set commits first, or the create is 409 and writes nothing", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { userId, workoutId, weIds } = await workoutWith("bodyweight_reps");
      const [fin, add] = await Promise.allSettled([
        finish(userId, workoutId),
        repo.createSet(userId, weIds[0]!, { setType: "warmup" }),
      ]);
      expect(fin.status).toBe("fulfilled");
      if (add.status === "rejected") {
        expect(add.reason).toBeInstanceOf(WorkoutFinishedError);
        const n = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "set_entry" WHERE workout_exercise_id = $1::uuid`,
          weIds[0]!,
        );
        expect(Number(n[0]!.n)).toBe(0);
      } else {
        // Same clock-capture tolerance 05.0's AC9 test documents: ended_at is
        // client-captured before dispatch, created_at is DB now().
        const endedAt = (fin as PromiseFulfilledResult<UpdateWorkoutResult>).value.workout.endedAt!;
        expect(add.value.set.createdAt.getTime() - endedAt.getTime()).toBeLessThanOrEqual(50);
      }
    }
  });

  it("AC21 — finish vs. a create adding an incomplete working set: only the two documented outcomes", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { userId, workoutId, weIds } = await workoutWith("weight_reps");
      await repo.createSet(userId, weIds[0]!, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
      const [fin, add] = await Promise.allSettled([
        finish(userId, workoutId),
        repo.createSet(userId, weIds[0]!, { reps: 5 }), // working, no weight: incomplete
      ]);
      if (add.status === "fulfilled") {
        // (a) the create committed first ⇒ the finish must have seen it.
        expect(fin.status).toBe("rejected");
        expect((fin as PromiseRejectedResult).reason).toBeInstanceOf(IncompleteWorkingSetsError);
      } else {
        // (b) the finish locked first ⇒ create is 409 with nothing written; finish succeeded.
        expect(add.reason).toBeInstanceOf(WorkoutFinishedError);
        expect(fin.status).toBe("fulfilled");
      }
      // Never: a finished workout holding an incomplete working set.
      const bad = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "set_entry" se JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
         JOIN "workout" w ON w.id = we.workout_id
         WHERE w.id = $1::uuid AND w.ended_at IS NOT NULL AND se.set_type = 'working' AND se.weight IS NULL`,
        workoutId,
      );
      expect(Number(bad[0]!.n)).toBe(0);
    }
  });

  it("Review Focus 2 / D10 — PATCH clearing reps races a finish: never a finished workout with an incomplete working set", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { userId, workoutId, weIds } = await workoutWith("weight_reps");
      const s = (await repo.createSet(userId, weIds[0]!, { reps: 5, weight: 100, weightUnit: "kg" })).set;
      const [fin, patch] = await Promise.allSettled([
        finish(userId, workoutId),
        repo.updateSet(userId, s.id, { reps: null }),
      ]);
      if (patch.status === "fulfilled") {
        expect(fin.status).toBe("rejected");
        expect((fin as PromiseRejectedResult).reason).toBeInstanceOf(IncompleteWorkingSetsError);
      } else {
        expect(patch.reason).toBeInstanceOf(WorkoutFinishedError);
        expect(fin.status).toBe("fulfilled");
      }
    }
  });

  it("Review Focus 5 — create racing DELETE of its workout_exercise: 201 or 404, never a 500", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { userId, weIds } = await workoutWith("bodyweight_reps");
      const [add, del] = await Promise.allSettled([
        repo.createSet(userId, weIds[0]!, { reps: 5 }),
        repo.deleteWorkoutExercise(userId, weIds[0]!),
      ]);
      expect(del.status).toBe("fulfilled");
      if (add.status === "rejected") expect(add.reason).toBeInstanceOf(NotFoundError);
    }
  });
});
