import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 10));

describe.skipIf(!shouldRunIntegration())("Spec 07.0 — recomputeRecordsForRoots (real Postgres)", () => {
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

  const recompute = (userId: string, roots: string[]) =>
    db.prisma.$transaction((tx) => recomputeRecordsForRoots(tx, userId, roots));

  describe("AC10 — the qualifying-set query is exact", () => {
    it("only working sets of finished workouts count; is_complete=false counts; null measures are tolerated", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { setIds } = await logWorkout(db, user, {
        startedAt: day(1),
        exercises: [
          {
            exerciseId: bench,
            sets: [
              { setType: "warmup", reps: 5, weight: 200 },
              { setType: "drop", reps: 5, weight: 190 },
              { setType: "failure", reps: 5, weight: 180 },
              { setType: "working", reps: 5, weight: 100, isComplete: false },
              { setType: "working", reps: null, weight: null },
            ],
          },
        ],
      });
      await logWorkout(db, user, {
        startedAt: day(2),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 300 }] }],
      });

      const written = await recompute(user, [bench]);

      const heaviest = written.find((r) => r.recordType === "heaviest_weight")!;
      expect(heaviest.value).toBe(100);
      expect(heaviest.sourceSetId).toBe(setIds[0]![3]);
      expect((await recordsOf(db, user)).map((r) => r.record_type)).toEqual([
        "best_est_1rm",
        "best_set_volume",
        "heaviest_weight",
      ]);
    });

    it("another user's sets never reach the loader", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const bench = await insertExercise(db);
      await logWorkout(db, b, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 300 }] }] });
      await logWorkout(db, a, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      const written = await recompute(a, [bench]);
      expect(written.find((r) => r.recordType === "heaviest_weight")!.value).toBe(100);
    });
  });

  describe("AC11 — fork lineage merges", () => {
    it("global + two forks share one root; the record carries the source exercise and its name snapshot", async () => {
      const user = await insertUser(db);
      const global = await insertExercise(db, { name: "Bench Press" });
      const fork1 = await insertExercise(db, { ownerUserId: user, forkedFrom: global, name: "My Bench" });
      const fork2 = await insertExercise(db, { ownerUserId: user, forkedFrom: global, name: "Paused Bench" });
      await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: global, name: "Bench Press", sets: [{ reps: 5, weight: 100 }] }] });
      await logWorkout(db, user, { startedAt: day(2), exercises: [{ exerciseId: fork1, name: "My Bench", sets: [{ reps: 5, weight: 105 }] }] });
      const { setIds } = await logWorkout(db, user, {
        startedAt: day(3),
        exercises: [{ exerciseId: fork2, name: "Paused Bench", sets: [{ reps: 5, weight: 110 }] }],
      });

      const written = await recompute(user, [global]);

      const heaviest = written.find((r) => r.recordType === "heaviest_weight")!;
      expect(heaviest).toMatchObject({
        exerciseId: global,
        sourceExerciseId: fork2,
        exerciseName: "Paused Bench",
        value: 110,
        previousValue: 105,
        sourceSetId: setIds[0]![0],
      });
      const rows = await recordsOf(db, user);
      expect(new Set(rows.map((r) => r.exercise_id))).toEqual(new Set([global]));
    });

    it("a from-scratch custom exercise is its own root", async () => {
      const user = await insertUser(db);
      const custom = await insertExercise(db, { ownerUserId: user });
      await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: custom, sets: [{ reps: 5, weight: 50 }] }] });
      const written = await recompute(user, [custom]);
      expect(written.length).toBe(3);
      expect(written.every((r) => r.exerciseId === custom)).toBe(true);
    });
  });

  describe("Review Focus 1 — one workout logging the same lineage twice", () => {
    it("earliest by position wins a tie within the workout", async () => {
      const user = await insertUser(db);
      const global = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: user, forkedFrom: global });
      // position 0 = fork, position 1 = origin; both 100 kg × 5
      const { setIds } = await logWorkout(db, user, {
        startedAt: day(1),
        exercises: [
          { exerciseId: fork, sets: [{ reps: 5, weight: 100 }] },
          { exerciseId: global, sets: [{ reps: 5, weight: 100 }] },
        ],
      });
      const written = await recompute(user, [global]);
      expect(written.find((r) => r.recordType === "heaviest_weight")!.sourceSetId).toBe(setIds[0]![0]);
    });
  });

  describe("Review Focus 2 — lb-entered weights", () => {
    it("the record value equals the stored weight_kg exactly", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await logWorkout(db, user, {
        startedAt: day(1),
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 225, weightUnit: "lb" }] }],
      });
      const stored = await db.prisma.$queryRawUnsafe<{ w: string }[]>(`SELECT weight_kg::text AS w FROM "set_entry"`);
      await recompute(user, [bench]);
      const row = (await recordsOf(db, user)).find((r) => r.record_type === "heaviest_weight")!;
      expect(row.value).toBe(stored[0]!.w);
    });
  });

  it("replaces a root's rows wholesale: a root with no qualifying sets loses its rows", async () => {
    const user = await insertUser(db);
    const bench = await insertExercise(db);
    const { workoutId } = await logWorkout(db, user, {
      startedAt: day(1),
      exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }],
    });
    await recompute(user, [bench]);
    expect(await recordsOf(db, user)).toHaveLength(3);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "workout" WHERE id = $1::uuid`, workoutId);
    await recompute(user, [bench]);
    expect(await recordsOf(db, user)).toHaveLength(0);
  });

  it("an empty roots list returns []", async () => {
    const user = await insertUser(db);
    await expect(recompute(user, [])).resolves.toEqual([]);
  });
});
