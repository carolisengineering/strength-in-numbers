import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

/**
 * Spec 09 AC29 / D13 — an account purge reaches routines and items in one
 * statement even when an item points at the user's own custom exercise
 * (CASCADE, not RESTRICT, so the FK check cannot fire mid-cascade).
 */
describe.skipIf(!shouldRunIntegration())("AC29 — account purge cascades routines (real Postgres)", () => {
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

  it("DELETE FROM user with a custom exercise used in the user's own routine and a routine-started workout succeeds in one statement", async () => {
    const u = await insertUser(db);
    const custom = await insertExercise(db, { ownerUserId: u });
    const r = await createRoutineRepository(db.prisma).create(u, routineFixture([custom]));
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(), exercises: [] });
    await db.prisma.$executeRawUnsafe(
      `UPDATE "workout" SET routine_id = $1::uuid, routine_name_snapshot = 'Push A' WHERE id = $2::uuid`,
      r.id,
      workoutId,
    );
    await expect(db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, u)).resolves.toBe(1);
    for (const table of ["routine", "routine_item", "workout", "exercise"]) {
      const [n] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`);
      expect(Number(n!.n), table).toBe(0);
    }
  });

  it("AC21 (09.1) — DELETE FROM user cascades routine_item_set and workout_planned_set", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const routine = await createRoutineRepository(db.prisma).create(u, {
      name: "R", notes: null, items: [{ exerciseId: ex, sets: [{ weight: 50, weightUnit: "kg" }] }],
    });
    const started = await createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)).createWorkout(
      u,
      { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id },
      "UTC",
    );
    expect(started.plannedSetCount).toBe(1);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, u);
    const n = (await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT (SELECT count(*) FROM "routine_item_set") + (SELECT count(*) FROM "workout_planned_set") AS n`))[0]!.n;
    expect(Number(n)).toBe(0);
  });
});
