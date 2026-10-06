import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 10));
const endOf = (d: number) => new Date(Date.UTC(2026, 8, d, 11)).toISOString();
/** Comparable view of a row — a row's own id is not stable (D15). */
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id,
    record_type,
    value,
    previous_value,
    source_set_entry_id,
    workout_id,
  }));

describe.skipIf(!shouldRunIntegration())("AC18 — concurrent PR writers equal a serial result, no deadlock", () => {
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

  const repo = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

  /** Recompute everything from scratch in a separate transaction and compare. */
  async function expectEqualsRebuild(userId: string, roots: string[]) {
    const live = shape(await recordsOf(db, userId));
    await db.prisma.$transaction(async (tx) => {
      await lockUserRecords(tx, userId);
      await recomputeRecordsForRoots(tx, userId, roots);
    });
    expect(shape(await recordsOf(db, userId))).toEqual(live);
  }

  function expectNoDeadlock(results: PromiseSettledResult<unknown>[]) {
    for (const r of results) {
      if (r.status === "rejected") expect(String(r.reason)).not.toMatch(/40P01|deadlock/i);
    }
  }

  it("(a) finish W1 concurrent with delete of finished W0", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId: w0 } = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }],
      });
      await repo().updateWorkout(user, w0, { endedAt: endOf(1) });
      const { workoutId: w1 } = await logWorkout(db, user, {
        startedAt: day(2),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 90 }] }],
      });

      const results = await Promise.allSettled([
        repo().updateWorkout(user, w1, { endedAt: endOf(2) }),
        repo().deleteWorkout(user, w0),
      ]);
      expectNoDeadlock(results);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      // Either order ends the same: W0 gone, W1 holds every record.
      const rows = await recordsOf(db, user);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.workout_id === w1)).toBe(true);
      await expectEqualsRebuild(user, [bench]);
    }
  });

  it("(b) finish W1 concurrent with delete of W1 itself", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId: w1 } = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }],
      });

      const results = await Promise.allSettled([
        repo().updateWorkout(user, w1, { endedAt: endOf(1) }),
        repo().deleteWorkout(user, w1),
      ]);
      expectNoDeadlock(results);
      expect(results[1]!.status).toBe("fulfilled"); // the delete always lands
      if (results[0]!.status === "rejected") {
        // delete went first: the finish found no row
        expect(results[0].reason).toBeInstanceOf(NotFoundError);
      }
      expect(await recordsOf(db, user)).toEqual([]);
    }
  });

  it("(c) a finish racing a second finish attempt by the same user", async () => {
    // 05.0's one-in-progress-workout invariant means two genuinely concurrent
    // successful finishes for one user cannot exist; the closest real race is
    // a finish concurrent with a finish attempt on an already-finished workout
    // of the same lineage, which still contends for the same row and PR locks.
    for (let i = 0; i < 10; i++) {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId: w2 } = await logWorkout(db, user, {
        startedAt: day(2),
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 110 }] }],
      });
      const { workoutId: w1 } = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }],
      });
      const results = await Promise.allSettled([
        repo().updateWorkout(user, w1, { endedAt: endOf(1) }),
        repo().updateWorkout(user, w2, { endedAt: endOf(2) }),
      ]);
      expectNoDeadlock(results);
      expect(results[0]!.status).toBe("fulfilled");
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(WorkoutFinishedError);
      expect((await recordsOf(db, user)).find((r) => r.record_type === "heaviest_weight")!.workout_id).toBe(w2);
      await expectEqualsRebuild(user, [bench]);
    }
  });

  it("transactions run at READ COMMITTED (§6.3's correctness argument depends on it)", async () => {
    const level = await db.prisma.$transaction((tx) => tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`);
    expect(level[0]!.transaction_isolation).toBe("read committed");
  });
});
