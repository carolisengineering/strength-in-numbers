import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { NotFoundError, WorkoutFinishedError, WorkoutWouldBeEmptyError } from "../../src/errors/app-error.js";
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

  // ---- Spec 07.4 Phase A: finished-mode edits in the PR lock graph ----
  async function cardOf(workoutId: string): Promise<string> {
    const rows = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position LIMIT 1`, workoutId);
    return rows[0]!.id;
  }

  it("07.4 AC11 — two concurrent deletes of a finished workout's last two sets: one 204, one would-be-empty, one set left", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 90 }] }] });
      const results = await Promise.allSettled([repo().deleteSet(user, w.setIds[0]![0]!), repo().deleteSet(user, w.setIds[0]![1]!)]);
      expectNoDeadlock(results);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(WorkoutWouldBeEmptyError);
      const n = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "set_entry" WHERE workout_exercise_id = $1::uuid`, await cardOf(w.workoutId));
      expect(n[0]!.n).toBe(1);
    }
  });

  describe("07.4 AC15 — a finished-mode set edit against each concurrent writer equals a serial result", () => {
    /** W0 finished (the edited one, record holder), W1 live, W2 finished; records seeded by a rebuild. */
    async function scene() {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w0 = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 95 }] }] });
      const w2 = await logWorkout(db, user, { startedAt: day(2), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 98 }] }] });
      const w1 = await logWorkout(db, user, { startedAt: day(3), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 97 }] }] });
      await db.prisma.$transaction(async (tx) => {
        await lockUserRecords(tx, user);
        await recomputeRecordsForRoots(tx, user, [bench]);
      });
      return { user, bench, w0, w1, w2, edit: () => repo().updateSet(user, w0.setIds[0]![0]!, { weight: 120 }) };
    }

    it.each([
      ["a finish of another workout", (c: Awaited<ReturnType<typeof scene>>) => repo().updateWorkout(c.user, c.w1.workoutId, { endedAt: endOf(3) })],
      ["a delete of another workout", (c: Awaited<ReturnType<typeof scene>>) => repo().deleteWorkout(c.user, c.w2.workoutId)],
      ["a delete of the same workout", (c: Awaited<ReturnType<typeof scene>>) => repo().deleteWorkout(c.user, c.w0.workoutId)],
      ["another edit of the same workout", (c: Awaited<ReturnType<typeof scene>>) => repo().updateSet(c.user, c.w0.setIds[0]![1]!, { weight: 110 })],
      ["a live set create on the user's live workout", async (c: Awaited<ReturnType<typeof scene>>) =>
        repo().createSet(c.user, await cardOf(c.w1.workoutId), { reps: 5, weight: 99, weightUnit: "kg", isComplete: true })],
    ])("vs %s: no deadlock, only serial outcomes, the table equals a rebuild", async (_name, other) => {
      for (let i = 0; i < 10; i++) {
        const c = await scene();
        const results = await Promise.allSettled([c.edit(), other(c)]);
        expectNoDeadlock(results);
        for (const r of results) {
          // The only non-serial-looking outcome allowed is the edit losing to a delete of its own workout.
          if (r.status === "rejected") expect(r.reason).toBeInstanceOf(NotFoundError);
        }
        await expectEqualsRebuild(c.user, [c.bench]);
      }
    });
  });

  it("transactions run at READ COMMITTED (§6.3's correctness argument depends on it)", async () => {
    const level = await db.prisma.$transaction((tx) => tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`);
    expect(level[0]!.transaction_isolation).toBe("read committed");
  });
});
