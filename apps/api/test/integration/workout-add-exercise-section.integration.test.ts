// Spec 09.4 AC16 / AC22 — a plain "Add exercise" joins the last section iff it was added in the workout (C4);
// workout sections and routines never reach each other. Real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { RoutineWriteSchema } from "@sin/core";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, exerciseIdsOf, workoutWithSections } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.4 — where an added exercise goes (real Postgres)", () => {
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
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const routines = () => createRoutineRepository(db.prisma);
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);

  async function user() {
    const u = await insertUser(db);
    return { u, ex: await insertExercise(db, { ownerUserId: u }) };
  }
  /** A routine with copied sections W and S (one item each), started; the loose tail `·Y` added after. */
  async function routineWorkout(u: string, ex: string) {
    const routine = await routines().create(u, RoutineWriteSchema.parse({
      name: "Push day",
      sections: [{ key: "w", name: "W" }, { key: "s", name: "S" }],
      items: [{ exerciseId: ex, sectionKey: "w" }, { exerciseId: ex, sectionKey: "s" }],
    }));
    const started = await workouts().createWorkout(u, {
      clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id,
    }, "UTC");
    const workoutId = started.workout.id;
    const y = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
    return { routine, workoutId, y };
  }

  describe("09.4 AC16 — where an added exercise goes", () => {
    it("(a) a manual workout plus an added section: the add joins it", async () => {
      const { u, ex } = await user();
      const started = await workouts().createWorkout(u, { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null }, "UTC");
      const section = await workouts().addWorkoutSection(u, started.workout.id, { name: "Warm-up", notes: null });
      const added = await workouts().addWorkoutExercise(u, started.workout.id, { exerciseId: ex });
      expect([added.sectionId, added.position]).toEqual([section.id, 0]);
    });

    it("(b) a routine workout with only copied sections: the add is loose at the end", async () => {
      const { u, ex } = await user();
      const { workoutId, y } = await routineWorkout(u, ex);
      expect([y.sectionId, y.position]).toEqual([null, 2]);
      const another = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      expect([another.sectionId, another.position]).toEqual([null, 3]);
    });

    it("(c) the same plus an added section C: [a1(W), b1(S), X(C), ·Y]; (d) C removed → loose again", async () => {
      const { u, ex } = await user();
      const { workoutId, y } = await routineWorkout(u, ex);
      const c = await workouts().addWorkoutSection(u, workoutId, { name: "C", notes: null });
      const x = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      expect([x.sectionId, x.position]).toEqual([c.id, 2]);
      const order = await exerciseIdsOf(db, workoutId);
      expect(order.slice(2)).toEqual([x.id, y.id]);

      await workouts().removeWorkoutSection(u, c.id);
      const z = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      expect([z.sectionId, z.position]).toEqual([null, 4]);
    });

    it("(e) an added section that is not last: the add is loose", async () => {
      const { u, ex } = await user();
      const { workoutId } = await workoutWithSections(db, u, ex, { sections: [{ name: "Mine", added: true }, { name: "Copied" }], exercises: [0, 1] });
      const added = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      expect([added.sectionId, added.position]).toEqual([null, 2]);
    });

    it("(f) an explicit position with an added last section: loose at that position", async () => {
      const { u, ex } = await user();
      const { workoutId } = await workoutWithSections(db, u, ex, { sections: [{ name: "Mine", added: true }], exercises: [0, 0] });
      const added = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex, position: 0 });
      expect([added.sectionId, added.position]).toEqual([null, 0]);
    });

    it("(g) a finished workout with an added section: the add joins it and recomputes nothing", async () => {
      const { u, ex } = await user();
      const { workoutId, sectionIds } = await workoutWithSections(db, u, ex, {
        sections: [{ name: "Copied" }, { name: "Mine", added: true }], exercises: [0, null], finished: true,
      });
      const added = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      expect([added.sectionId, added.position, added.finishedEdit?.recordsRecomputed]).toEqual([sectionIds[1], 1, false]);
    });
  });

  describe("09.4 AC22 — routine isolation", () => {
    const routineRows = (routineId: string) =>
      q(`SELECT to_jsonb(s) AS j FROM "routine_section" s WHERE routine_id = $1::uuid ORDER BY position`, routineId);
    const workoutRows = async (workoutId: string) => JSON.stringify([
      await q(`SELECT to_jsonb(s) AS j FROM "workout_section" s WHERE workout_id = $1::uuid ORDER BY position`, workoutId),
      await q(`SELECT to_jsonb(we) AS j FROM "workout_exercise" we WHERE workout_id = $1::uuid ORDER BY position`, workoutId),
    ]);

    it("section writes never reach the routine; a routine replace or delete never reaches the workout", async () => {
      const { u, ex } = await user();
      const { routine, workoutId, y } = await routineWorkout(u, ex);
      const before = await routineRows(routine.id);
      const c = await workouts().addWorkoutSection(u, workoutId, { name: "C", notes: null });
      const w = (await workouts().getWorkoutById(u, workoutId)).sections[0]!;
      await workouts().updateWorkoutSection(u, w.id, { name: "Renamed", notes: "n" });
      await workouts().updateWorkoutExercise(u, y.id, { sectionId: c.id });
      expect(await routineRows(routine.id)).toEqual(before);

      const snapshot = await workoutRows(workoutId);
      await routines().replace(u, routine.id, RoutineWriteSchema.parse({ name: "Push day v2", items: [{ exerciseId: ex }] }));
      expect(await workoutRows(workoutId)).toBe(snapshot);
      await routines().delete(u, routine.id);
      expect(await workoutRows(workoutId)).toBe(snapshot);
    });
  });
});
