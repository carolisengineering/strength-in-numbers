// Spec 07.5 Phase B, AC18–AC23 — most reps at a weight through the one shared recompute, against a real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { createScopedDb } from "../../src/db/scoped.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository, lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { captureStatements } from "./one-off-helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow, type SetSpec } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 18));
/** Comparable view of a row — a row's own id is not stable (07.0 D15). */
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id, at_weight_kg }) => ({
    exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id, at_weight_kg,
  }));
const atWeight = (rows: RecordRow[]) => rows.filter((r) => r.record_type === "max_reps_at_weight");
const INSERT_RECORD = /^\s*INSERT INTO "personal_record"/;
const silent = pino({ level: "silent" });

describe.skipIf(!shouldRunIntegration())("Spec 07.5 Phase B — most reps at a weight (real Postgres)", () => {
  let db: AppIntegrationDb;
  let statements: string[];
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    statements = captureStatements(db);
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  const repo = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  async function rebuild(userId: string, roots: string[]) {
    await db.prisma.$transaction(async (tx) => {
      await lockUserRecords(tx, userId);
      await recomputeRecordsForRoots(tx, userId, roots);
    });
  }
  /** The live table after an edit must equal a from-scratch recompute (07.0's reconciliation pattern). */
  async function expectEqualsRebuild(userId: string, roots: string[]) {
    const live = shape(await recordsOf(db, userId));
    await rebuild(userId, roots);
    expect(shape(await recordsOf(db, userId))).toEqual(live);
  }
  const lift = (exerciseId: string, sets: SetSpec[], name?: string) => ({ exerciseId, sets, ...(name ? { name } : {}) });
  async function cardsOf(workoutId: string): Promise<string[]> {
    const rows = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
    return rows.map((r) => r.id);
  }
  const insertsDuring = async (fn: () => Promise<unknown>) => {
    statements.length = 0;
    await fn();
    return statements.filter((s) => INSERT_RECORD.test(s)).length;
  };

  describe("07.5 AC19 — one INSERT per root, none for an empty root", () => {
    it("rows at three weights are written by one statement", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      await logWorkout(db, user, { startedAt: day(1), exercises: [lift(raise, [{ reps: 12, weight: 10 }, { reps: 8, weight: 12.5 }, { reps: 6, weight: 15 }])] });
      expect(await insertsDuring(() => rebuild(user, [raise]))).toBe(1);
      expect(atWeight(await recordsOf(db, user)).map((r) => r.at_weight_kg)).toEqual(["15.000", "12.500", "10.000"]);
    });
    it("a root with only 5-rep sets still gets its other rows in that one statement", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await logWorkout(db, user, { startedAt: day(1), exercises: [lift(bench, [{ reps: 5, weight: 100 }])] });
      expect(await insertsDuring(() => rebuild(user, [bench]))).toBe(1);
      const rows = await recordsOf(db, user);
      expect(rows.map((r) => r.record_type).sort()).toEqual(["best_est_1rm", "best_set_volume", "heaviest_weight"]);
      expect(rows.every((r) => r.at_weight_kg === null)).toBe(true);
    });
    it("a root with no qualifying set issues no INSERT", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await logWorkout(db, user, { startedAt: day(1), exercises: [lift(bench, [{ setType: "warmup", reps: 10, weight: 40 }])] });
      expect(await insertsDuring(() => rebuild(user, [bench]))).toBe(0);
      expect(await recordsOf(db, user)).toEqual([]);
    });
  });

  describe("07.5 AC20 — finished edits and deletes follow", () => {
    /** Day 1: 12.5 × 12; day 3: 12.5 × 14 and a second lift (so a card delete never empties the workout). */
    async function history() {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      const curl = await insertExercise(db);
      const early = await logWorkout(db, user, { startedAt: day(1), exercises: [lift(raise, [{ reps: 12, weight: 12.5 }])] });
      const late = await logWorkout(db, user, { startedAt: day(3), exercises: [lift(raise, [{ reps: 14, weight: 12.5 }]), lift(curl, [{ reps: 10, weight: 20 }])] });
      await rebuild(user, [raise, curl]);
      return { user, raise, curl, early, late, lateCards: await cardsOf(late.workoutId) };
    }

    it("every kind of finished edit leaves the table equal to a rebuild", async () => {
      const h = await history();
      const roots = [h.raise, h.curl];
      expect(atWeight(await recordsOf(db, h.user)).map((r) => [r.exercise_id, r.at_weight_kg, r.value, r.previous_value])).toEqual([
        [h.raise, "12.500", "14.000", "12.000"],
        [h.curl, "20.000", "10.000", null],
      ]);
      const { set } = await repo().createSet(h.user, h.lateCards[0]!, { reps: 7, weight: 15, weightUnit: "kg", isComplete: true });
      await expectEqualsRebuild(h.user, roots);
      await repo().updateSet(h.user, h.late.setIds[0]![0]!, { reps: 13 });
      await expectEqualsRebuild(h.user, roots);
      await repo().updateSet(h.user, set.id, { weight: 12.5 });
      await expectEqualsRebuild(h.user, roots);
      await repo().updateSet(h.user, set.id, { weight: 30, weightUnit: "lb" });
      await expectEqualsRebuild(h.user, roots);
      await repo().updateSet(h.user, set.id, { setType: "warmup" });
      await expectEqualsRebuild(h.user, roots);
      await repo().deleteSet(h.user, set.id);
      await expectEqualsRebuild(h.user, roots);
      await repo().updateWorkout(h.user, h.early.workoutId, { startedAt: day(5).toISOString() });
      await expectEqualsRebuild(h.user, roots);
      await repo().deleteWorkoutExercise(h.user, h.lateCards[1]!);
      await expectEqualsRebuild(h.user, roots);
      expect(atWeight(await recordsOf(db, h.user)).map((r) => r.exercise_id)).toEqual([h.raise]);
    });

    it("deleting the 14-rep holder leaves the earlier 12 as the record, with no previous", async () => {
      const h = await history();
      await repo().createSet(h.user, h.lateCards[1]!, { reps: 8, weight: 20, weightUnit: "kg", isComplete: true });
      await repo().deleteSet(h.user, h.late.setIds[0]![0]!);
      const row = atWeight(await recordsOf(db, h.user)).find((r) => r.exercise_id === h.raise)!;
      expect([row.at_weight_kg, row.value, row.previous_value, row.workout_id]).toEqual(["12.500", "12.000", null, h.early.workoutId]);
    });

    it("lowering the only qualifying set to 5 reps removes the row", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [lift(raise, [{ reps: 7, weight: 12.5 }])] });
      await rebuild(user, [raise]);
      expect(atWeight(await recordsOf(db, user))).toHaveLength(1);
      await repo().updateSet(user, w.setIds[0]![0]!, { reps: 5 });
      expect(atWeight(await recordsOf(db, user))).toEqual([]);
    });
  });

  describe("07.5 AC21 — the edit predicate", () => {
    it("a reps edit recomputes; an rpe-only edit reads and writes no records", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [lift(raise, [{ reps: 7, weight: 12.5 }])] });
      await rebuild(user, [raise]);
      statements.length = 0;
      await repo().updateSet(user, w.setIds[0]![0]!, { reps: 8 });
      expect(statements.some((s) => /DELETE FROM "personal_record"/.test(s))).toBe(true);
      expect(statements.some((s) => /AS root_id, se.id::text AS set_id/.test(s))).toBe(true);
      statements.length = 0;
      await repo().updateSet(user, w.setIds[0]![0]!, { rpe: 8 });
      expect(statements.some((s) => /DELETE FROM "personal_record"/.test(s))).toBe(false);
      // The recompute loader is the only statement that selects a set as `root_id` (`loadLineageSets`).
      expect(statements.some((s) => /AS root_id, se.id::text AS set_id/.test(s))).toBe(false);
    });
  });

  describe("07.5 AC7 — a live workout's sets produce nothing", () => {
    it("12.5 × 9 in a live workout writes no row, even on a recompute, until the workout is finished (minor 683)", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      const startedAt = day(1);
      const { workoutId } = await logWorkout(db, user, { startedAt, finish: "none", exercises: [lift(raise, [{ reps: 9, weight: 12.5 }])] });
      await rebuild(user, [raise]);
      expect(atWeight(await recordsOf(db, user))).toEqual([]);
      await repo().updateWorkout(user, workoutId, { endedAt: new Date(startedAt.getTime() + 3_600_000).toISOString() });
      expect(atWeight(await recordsOf(db, user)).map((r) => [r.at_weight_kg, r.value, r.previous_value, r.workout_id])).toEqual([["12.500", "9.000", null, workoutId]]);
    });
  });

  describe("07.5 AC22 — forks share rows", () => {
    it("the origin's 7 and the fork's 9 at 12.5 kg are one row on the root, labeled by the fork", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db, { name: "Lateral Raise" });
      const mine = await insertExercise(db, { name: "Lateral Raise (mine)", ownerUserId: user, forkedFrom: raise });
      await logWorkout(db, user, { startedAt: day(1), exercises: [lift(raise, [{ reps: 7, weight: 12.5 }], "Lateral Raise")] });
      await logWorkout(db, user, { startedAt: day(3), exercises: [lift(mine, [{ reps: 9, weight: 12.5 }], "Lateral Raise (mine)")] });
      await rebuild(user, [raise]);
      const rows = atWeight(await recordsOf(db, user));
      expect(rows.map((r) => [r.exercise_id, r.value, r.previous_value])).toEqual([[raise, "9.000", "7.000"]]);
      const listed = (await createPersonalRecordRepository(db.prisma).list(user, {})).filter((r) => r.recordType === "max_reps_at_weight");
      expect(listed.map((r) => [r.sourceExerciseId, r.exerciseName])).toEqual([[mine, "Lateral Raise (mine)"]]);
    });
  });

  describe("07.5 AC23 — rebuild", () => {
    it("records:rebuild is idempotent and equals the live finish path over ten workouts", async () => {
      const user = await insertUser(db);
      const raise = await insertExercise(db);
      const reps = [6, 8, 7, 9, 9, 11, 5, 12, 10, 13];
      const weights = [10, 12.5, 10, 12.5, 15, 10, 15, 12.5, 15, 10];
      for (let i = 0; i < reps.length; i++) {
        const startedAt = day(i + 1);
        const { workoutId } = await logWorkout(db, user, { startedAt, finish: "none", exercises: [lift(raise, [{ reps: reps[i]!, weight: weights[i]! }])] });
        await repo().updateWorkout(user, workoutId, { endedAt: new Date(startedAt.getTime() + 3_600_000).toISOString() });
      }
      const live = shape(await recordsOf(db, user));
      expect(atWeight(await recordsOf(db, user))).toHaveLength(3);
      await rebuildRecords(db.prisma, silent, {});
      const once = shape(await recordsOf(db, user));
      await rebuildRecords(db.prisma, silent, {});
      expect(shape(await recordsOf(db, user))).toEqual(once);
      expect(once).toEqual(live);
    });
  });

  describe("07.5 AC18 — RLS keeps another user's rows out", () => {
    it("user B's scoped list and raw scoped statements see and change none of A's rows", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const raise = await insertExercise(db);
      await logWorkout(db, a, { startedAt: day(1), exercises: [lift(raise, [{ reps: 9, weight: 12.5 }])] });
      await rebuild(a, [raise]);
      expect(atWeight(await recordsOf(db, a))).toHaveLength(1);
      const scoped = createScopedDb(db.app);
      expect(await createPersonalRecordRepository(scoped).list(b, {})).toEqual([]);
      expect(await createPersonalRecordRepository(scoped).list(b, { exerciseId: raise })).toEqual([]);
      const asB = scoped.as(b);
      expect(await asB.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "personal_record" WHERE record_type = 'max_reps_at_weight'`).toEqual([{ n: 0n }]);
      expect(await asB.$executeRaw`UPDATE "personal_record" SET value = 99 WHERE user_id = ${a}::uuid`).toBe(0);
      expect(await asB.$executeRaw`DELETE FROM "personal_record" WHERE user_id = ${a}::uuid`).toBe(0);
      expect(atWeight(await recordsOf(db, a)).map((r) => r.value)).toEqual(["9.000"]);
    });
  });
});
