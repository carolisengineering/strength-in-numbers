// Spec 07.4 AC5 — a finish committing between a set write's preflight and its row lock restarts the
// write once in finished mode: the set is stored and its records are recomputed, never a 409.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL } from "./records-helpers.js";

describe.skipIf(!shouldRunIntegration())("07.4 AC5 — a finish landing mid-write restarts it in finished mode (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  it("the create blocks on FOR SHARE behind an uncommitted finish, then lands as a finished-mode write with records", async () => {
    const user = await insertUser(db);
    const bench = await insertExercise(db);
    const startedAt = new Date(Date.now() - 3_600_000);
    const w = await logWorkout(db, user, { startedAt, finish: "none", exercises: [{ exerciseId: bench, sets: [] }] });
    const [card] = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM "workout_exercise" WHERE workout_id = $1::uuid`, w.workoutId);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let updated!: () => void;
    const finishHeld = new Promise<void>((resolve) => (updated = resolve));
    // The "finish": an UPDATE holding the row lock until the gate opens.
    const finishing = db.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "workout" SET ended_at = now() WHERE id = $1::uuid`, w.workoutId);
        updated();
        await gate;
      },
      { timeout: 20_000 },
    );
    await finishHeld;
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const creating = repo.createSet(user, card!.id, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
    await new Promise((r) => setTimeout(r, 300)); // the create's preflight saw a live workout; it now waits on FOR SHARE
    release();
    await finishing;
    const result = await creating;

    expect(result.created).toBe(true);
    expect(result.finishedEdit).toMatchObject({ workoutId: w.workoutId, recordsRecomputed: true });
    const rows = await recordsOf(db, user);
    expect(rows.some((r) => r.source_set_entry_id === result.set.id)).toBe(true);
  });
});
