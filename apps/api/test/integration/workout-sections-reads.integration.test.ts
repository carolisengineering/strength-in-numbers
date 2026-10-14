import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, exerciseIdsOf, insertWorkoutSection, setExerciseSection } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.2 — workout reads and writes (real Postgres)", () => {
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

  /** In-progress workout with three exercises; sections inserted by raw SQL (Task 6 tests the real copy). */
  async function sectioned() {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }, { exerciseId: ex, sets: [] }, { exerciseId: ex, sets: [] }] });
    const [w0, w1] = [await insertWorkoutSection(db, workoutId, 1, "Main", "Heavy"), await insertWorkoutSection(db, workoutId, 0, "Warm-up")];
    const [e0, e1, e2] = await exerciseIdsOf(db, workoutId);
    await setExerciseSection(db, e1!, w0);
    await setExerciseSection(db, e2!, w0);
    await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET routine_notes_snapshot = $2 WHERE id = $1::uuid`, workoutId, "Routine note\r\nline two");
    return { u, ex, workoutId, e0: e0!, e1: e1!, e2: e2!, main: w0, warm: w1 };
  }

  it("AC3 — detail returns sections by position, the routine note and each exercise's sectionId", async () => {
    const { u, workoutId, main, warm } = await sectioned();
    const d = await workouts().getWorkoutById(u, workoutId);
    expect(d.sections.map((s) => [s.id, s.position, s.name, s.notes])).toEqual([[warm, 0, "Warm-up", null], [main, 1, "Main", "Heavy"]]);
    expect(d.routineNotes).toBe("Routine note\r\nline two");
    expect(d.exercises.map((e) => e.sectionId)).toEqual([null, main, main]);
    expect((await workouts().getActiveWorkout(u)).sections).toEqual(d.sections);
  });

  it("AC3 — a workout written before 0011 reads sections: [], routineNotes: null, sectionId: null", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    const d = await workouts().getWorkoutById(u, workoutId);
    expect([d.sections, d.routineNotes, d.exercises[0]!.sectionId]).toEqual([[], null, null]);
  });

  it("AC17 — add is loose whatever the sections; reorder and regroup keep section_id; remove leaves the section", async () => {
    const { u, ex, workoutId, e1, e2, main } = await sectioned();
    const added = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
    expect(added.sectionId).toBeNull();
    const moved = await workouts().updateWorkoutExercise(u, e2, { position: 0 });
    expect(moved.sectionId).toBe(main);
    expect((await workouts().updateWorkoutExercise(u, e1, { supersetGroup: 3 })).sectionId).toBe(main);
    await workouts().deleteWorkoutExercise(u, e1);
    const d = await workouts().getWorkoutById(u, workoutId);
    expect(d.sections).toHaveLength(2);
    expect(d.exercises.find((e) => e.id === e2)!.sectionId).toBe(main);
  });

  it("AC18 — notes: set, clear, absent key, position-only, supersetGroup-only; finished workout → WorkoutFinishedError", async () => {
    const { u, workoutId, e0 } = await sectioned();
    expect((await workouts().updateWorkoutExercise(u, e0, { notes: "x" })).notes).toBe("x");
    expect((await workouts().updateWorkoutExercise(u, e0, { supersetGroup: 2 })).notes).toBe("x");
    expect((await workouts().updateWorkoutExercise(u, e0, { position: 1 })).notes).toBe("x");
    expect((await workouts().updateWorkoutExercise(u, e0, {})).notes).toBe("x");
    expect((await workouts().updateWorkoutExercise(u, e0, { notes: null })).notes).toBeNull();
    await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET ended_at = now() WHERE id = $1::uuid`, workoutId);
    await expect(workouts().updateWorkoutExercise(u, e0, { notes: "late" })).rejects.toBeInstanceOf(WorkoutFinishedError);
  });
});
