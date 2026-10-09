import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";

/**
 * Spec 09 AC23 / D10 — `supersetGroup` on the exercise-within-workout PATCH:
 * any 1..99, `null` clears, a group of one and non-adjacent members are fine,
 * positions are never touched, and the 05.0 lock/finished rules still apply.
 */
describe.skipIf(!shouldRunIntegration())("AC23 — PATCH workout exercise supersetGroup (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });

  const repo = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

  it("set, clear, any 1..99, group of one, non-adjacent; position untouched; combined body; key-absent leaves it; null-on-null is a no-op (Review Focus 4); finished → 409; foreign → 404", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const { workout } = await repo().createWorkout(
      u,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const a = await repo().addWorkoutExercise(u, workout.id, { exerciseId: ex });
    const b = await repo().addWorkoutExercise(u, workout.id, { exerciseId: ex });
    const c = await repo().addWorkoutExercise(u, workout.id, { exerciseId: ex });
    expect([a.supersetGroup, b.supersetGroup, c.supersetGroup]).toEqual([null, null, null]);

    const one = await repo().updateWorkoutExercise(u, a.id, { supersetGroup: 42 });
    expect(one.supersetGroup).toBe(42);
    expect(one.position).toBe(a.position);

    const far = await repo().updateWorkoutExercise(u, c.id, { supersetGroup: 42 }); // non-adjacent to a
    expect(far.supersetGroup).toBe(42);

    const combined = await repo().updateWorkoutExercise(u, b.id, { supersetGroup: 99, notes: "x", position: 0 });
    expect([combined.supersetGroup, combined.notes, combined.position]).toEqual([99, "x", 0]);

    const cleared = await repo().updateWorkoutExercise(u, a.id, { supersetGroup: null });
    expect(cleared.supersetGroup).toBeNull();
    const noop = await repo().updateWorkoutExercise(u, a.id, { supersetGroup: null });
    expect(noop.supersetGroup).toBeNull();
    expect(noop.updatedAt.getTime()).toBeGreaterThanOrEqual(cleared.updatedAt.getTime());

    const untouched = await repo().updateWorkoutExercise(u, c.id, { notes: "y" });
    expect(untouched.supersetGroup).toBe(42);

    const detail = await repo().getWorkoutById(u, workout.id);
    expect(detail.exercises.map((e) => [e.id, e.position, e.supersetGroup])).toEqual([
      [b.id, 0, 99],
      [a.id, 1, null],
      [c.id, 2, 42],
    ]);

    const v = await insertUser(db);
    await expect(repo().updateWorkoutExercise(v, a.id, { supersetGroup: 1 })).rejects.toBeInstanceOf(NotFoundError);

    await repo().updateWorkout(u, workout.id, { endedAt: new Date(Date.now() + 60_000).toISOString() });
    await expect(repo().updateWorkoutExercise(u, a.id, { supersetGroup: 1 })).rejects.toBeInstanceOf(
      WorkoutFinishedError,
    );
  });
});
