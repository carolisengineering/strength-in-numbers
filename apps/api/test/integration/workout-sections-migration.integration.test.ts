// Spec 09.4 AC17 — migration 0014 (workout_section.added_in_workout), real Postgres. The whole-schema
// `prisma migrate diff` no-drift check (09.4 AC18) moved to new-modalities-migration (0015, Spec 05.3 AC18).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { RoutineWriteSchema } from "@sin/core";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { assertSectionsConsistent, insertWorkoutSection } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.4 — migration 0014 (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    if (db) await assertSectionsConsistent(db);
    await db?.stop();
  });

  it("09.4 AC17 — the column is a boolean, NOT NULL, default false", async () => {
    const rows = await db.prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string; data_type: string }[]>(
      `SELECT is_nullable, column_default, data_type FROM information_schema.columns
       WHERE table_name = 'workout_section' AND column_name = 'added_in_workout'`,
    );
    expect(rows).toEqual([{ is_nullable: "NO", column_default: "false", data_type: "boolean" }]);
  });

  it("09.4 AC17 — a row inserted without naming the column reads false", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    const id = await insertWorkoutSection(db, workoutId, 0, "Warm-up");
    const rows = await db.prisma.$queryRawUnsafe<{ added_in_workout: boolean }[]>(
      `SELECT added_in_workout FROM "workout_section" WHERE id = $1::uuid`, id);
    expect(rows).toEqual([{ added_in_workout: false }]);
  });

  it("09.4 AC17 — the start copy leaves a routine workout's sections addedInWorkout: false", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const routine = await createRoutineRepository(db.prisma).create(u, RoutineWriteSchema.parse({
      name: "Push day",
      sections: [{ key: "w", name: "Warm-up" }, { key: "m", name: "Main" }],
      items: [{ exerciseId: ex, sectionKey: "w" }, { exerciseId: ex, sectionKey: "m" }],
    }));
    const workouts = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const started = await workouts.createWorkout(u, {
      clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id,
    }, "UTC");
    const d = await workouts.getWorkoutById(u, started.workout.id);
    expect(d.sections.map((s) => [s.name, s.addedInWorkout])).toEqual([["Warm-up", false], ["Main", false]]);
  });
});
