import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { Modality } from "@sin/core";
import {
  IncompleteWorkingSetsError,
  NotFoundError,
  ValidationError,
  WorkoutFinishedError,
} from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import type { WorkoutRepository } from "../../src/repositories/workout.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.1 — set writes, detail reads and the finish rule against real
 * Postgres: real set_number arithmetic, real generated columns, real
 * completed_at timestamps, real cascades.
 */
describe.skipIf(!shouldRunIntegration())("Spec 05.1 set writes, reads and the finish rule (real Postgres)", () => {
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
  /** A user with an in-progress workout and one exercise per modality given. */
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

  it("AC3 — sequential creates number 1, 2, 3; a second workout_exercise starts at 1", async () => {
    const { userId, weIds } = await workoutWith("weight_reps", "weight_reps");
    const numbers = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await repo.createSet(userId, weIds[0]!, {})).set.setNumber);
    expect(numbers).toEqual([1, 2, 3]);
    expect((await repo.createSet(userId, weIds[1]!, {})).set.setNumber).toBe(1);
  });

  it("§4 — the generated columns come back converted on the wire record", async () => {
    const { userId, weIds } = await workoutWith("weight_reps", "distance_duration");
    expect((await repo.createSet(userId, weIds[0]!, { weight: 225, weightUnit: "lb" })).set.weightKg).toBe(102.058);
    expect((await repo.createSet(userId, weIds[1]!, { distance: 3.1, distanceUnit: "mi" })).set.distanceM).toBe(
      4988.966,
    );
  });

  it("AC8 — create with reps only, then PATCH { weight, weightUnit, isComplete } ⇒ ok; without weight ⇒ 422", async () => {
    const { userId, weIds } = await workoutWith("weight_reps");
    const a = (await repo.createSet(userId, weIds[0]!, { reps: 5 })).set;
    const done = await repo.updateSet(userId, a.id, { weight: 100, weightUnit: "kg", isComplete: true });
    expect(done).toMatchObject({ reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
    const b = (await repo.createSet(userId, weIds[0]!, { reps: 5 })).set;
    await expect(repo.updateSet(userId, b.id, { isComplete: true })).rejects.toBeInstanceOf(ValidationError);
  });

  it("Review Focus 4 — completedAt: stamped on false→true, kept on a repeated true, cleared on false", async () => {
    const { userId, weIds } = await workoutWith("bodyweight_reps");
    const s = (await repo.createSet(userId, weIds[0]!, { reps: 10 })).set;
    expect(s.completedAt).toBeNull();
    const first = await repo.updateSet(userId, s.id, { isComplete: true });
    expect(first.completedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const again = await repo.updateSet(userId, s.id, { isComplete: true, reps: 11 });
    expect(again.completedAt).toEqual(first.completedAt);
    expect((await repo.updateSet(userId, s.id, { isComplete: false })).completedAt).toBeNull();
  });

  it("AC9 — delete the middle of three: 1 and 3 remain, GET agrees, repeat delete 404, finished-workout delete 409", async () => {
    const { userId, workoutId, weIds } = await workoutWith("bodyweight_reps");
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await repo.createSet(userId, weIds[0]!, { reps: 5, isComplete: true })).set.id);
    }
    await repo.deleteSet(userId, ids[1]!);
    const detail = await repo.getWorkoutById(userId, workoutId);
    expect(detail.exercises[0]!.sets.map((s) => s.setNumber)).toEqual([1, 3]);
    await expect(repo.deleteSet(userId, ids[1]!)).rejects.toBeInstanceOf(NotFoundError);
    await finish(userId, workoutId);
    await expect(repo.deleteSet(userId, ids[0]!)).rejects.toBeInstanceOf(WorkoutFinishedError);
  });

  it("AC12 — GET /active and /{id} both carry sets ordered by setNumber", async () => {
    const { userId, workoutId, weIds } = await workoutWith("weight_reps", "duration");
    await repo.createSet(userId, weIds[1]!, { durationS: 30 });
    await repo.createSet(userId, weIds[0]!, {});
    await repo.createSet(userId, weIds[0]!, {});
    for (const d of [await repo.getActiveWorkout(userId), await repo.getWorkoutById(userId, workoutId)]) {
      expect(d.exercises.map((e) => e.sets.map((s) => s.setNumber))).toEqual([[1, 2], [1]]);
    }
  });

  it("AC13 — a working set missing reps blocks the finish (ended_at stays NULL); fixing it and retrying succeeds", async () => {
    const { userId, workoutId, weIds } = await workoutWith("weight_reps");
    const s = (await repo.createSet(userId, weIds[0]!, { weight: 100, weightUnit: "kg" })).set;
    await expect(finish(userId, workoutId)).rejects.toBeInstanceOf(IncompleteWorkingSetsError);
    const rows = await db.prisma.$queryRawUnsafe<{ ended_at: Date | null }[]>(
      `SELECT ended_at FROM "workout" WHERE id = $1::uuid`,
      workoutId,
    );
    expect(rows[0]!.ended_at).toBeNull();
    await repo.updateSet(userId, s.id, { reps: 5 });
    await expect(finish(userId, workoutId)).resolves.toBeDefined();
  });

  it("AC14 / D13 — warmup / drop / failure sets with no measures and isComplete: true are writable and don't block the finish", async () => {
    const { userId, workoutId, weIds } = await workoutWith("weight_reps");
    for (const setType of ["warmup", "drop", "failure"] as const) {
      await repo.createSet(userId, weIds[0]!, { setType, isComplete: true });
    }
    await expect(finish(userId, workoutId)).resolves.toBeDefined();
  });

  it("AC14 — the exempt types still get per-write validation: a drop set with weight + reps validates like a working one", async () => {
    const { userId, weIds } = await workoutWith("weight_reps");
    await expect(
      repo.createSet(userId, weIds[0]!, { setType: "drop", reps: 8, weight: 60, weightUnit: "kg", isComplete: true }),
    ).resolves.toBeDefined();
    await expect(repo.createSet(userId, weIds[0]!, { setType: "drop", durationS: 30 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
