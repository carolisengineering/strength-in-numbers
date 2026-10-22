import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — one-off routines (real Postgres)", () => {
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
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const markOneOff = (id: string) => x(`UPDATE "routine" SET one_off_until = created_at + interval '336 hours' WHERE id = $1::uuid`, id);

  /** A live workout pointed at `routineId` by raw SQL (Task 6 starts through the route). */
  async function liveFrom(u: string, ex: string, routineId: string | null) {
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] });
    if (routineId) await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, workoutId, routineId);
    return workoutId;
  }

  describe("09.3 AC4 — the workout flag", () => {
    it("is true only while the workout's routine exists and carries the mark", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const flag = async (workoutId: string) => {
        const byId = (await workouts().getWorkoutById(u, workoutId)).routineIsOneOff;
        const active = (await workouts().getActiveWorkout(u)).routineIsOneOff;
        expect(active).toBe(byId);
        return byId;
      };
      const clear = (workoutId: string) => x(`DELETE FROM "workout" WHERE id = $1::uuid`, workoutId);

      let w = await liveFrom(u, ex, null);
      expect(await flag(w)).toBe(false);
      await clear(w);

      const ordinary = await routines().create(u, routineFixture([ex], { name: "Ordinary" }));
      w = await liveFrom(u, ex, ordinary.id);
      expect(await flag(w)).toBe(false);
      await clear(w);

      const oneOff = await routines().create(u, routineFixture([ex], { name: "One-off" }));
      await markOneOff(oneOff.id);
      w = await liveFrom(u, ex, oneOff.id);
      expect(await flag(w)).toBe(true);

      await x(`UPDATE "routine" SET one_off_until = NULL WHERE id = $1::uuid`, oneOff.id);
      expect(await flag(w)).toBe(false);

      // Expired but held by this live workout: still a one-off.
      await x(
        `UPDATE "routine" SET created_at = now() - interval '20 days', one_off_until = now() - interval '6 days' WHERE id = $1::uuid`,
        oneOff.id,
      );
      expect(await flag(w)).toBe(true);

      await x(`DELETE FROM "routine" WHERE id = $1::uuid`, oneOff.id);
      expect(await flag(w)).toBe(false);
    });
  });
});
