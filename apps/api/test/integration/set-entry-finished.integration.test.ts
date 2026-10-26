// Spec 07.4 Phase A — set writes on a finished workout, against a real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { ValidationError, WorkoutWouldBeEmptyError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 18));
/** Comparable view of a row — a row's own id is not stable (07.0 D15). */
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id,
  }));

describe.skipIf(!shouldRunIntegration())("Spec 07.4 Phase A — set writes on a finished workout", () => {
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
  async function cardsOf(workoutId: string): Promise<string[]> {
    const rows = await db.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
    return rows.map((r) => r.id);
  }
  const heaviest = async (userId: string, root: string) =>
    (await recordsOf(db, userId)).find((r) => r.exercise_id === root && r.record_type === "heaviest_weight");

  /** Two finished bench workouts (day 1: 100 kg, day 3: 90 kg), records seeded by a rebuild. */
  async function history() {
    const user = await insertUser(db);
    const bench = await insertExercise(db);
    const early = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
    const late = await logWorkout(db, user, { startedAt: day(3), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 90 }, { setType: "warmup", reps: 5, weight: 40 }] }] });
    await rebuild(user, [bench]);
    return { user, bench, early, late, lateCard: (await cardsOf(late.workoutId))[0]! };
  }

  describe("07.4 AC1 / AC6 — records follow set edits exactly", () => {
    it("a heavier set added to the later workout takes the record; the table equals a rebuild", async () => {
      const { user, bench, late, lateCard } = await history();
      const { set, created, finishedEdit } = await repo().createSet(user, lateCard, { reps: 3, weight: 110, weightUnit: "kg", isComplete: true });
      expect(created).toBe(true);
      expect(finishedEdit).toMatchObject({ workoutId: late.workoutId, recordsRecomputed: true, rootCount: 1 });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(set.id);
      await expectEqualsRebuild(user, [bench]);
    });

    it("lowering the record set promotes the next best (from the later workout) and restates previous values", async () => {
      const { user, bench, early, late } = await history();
      await repo().updateSet(user, early.setIds[0]![0]!, { weight: 80 });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(late.setIds[0]![0]);
      await expectEqualsRebuild(user, [bench]);
    });

    it("deleting the record set promotes the next best", async () => {
      const { user, bench, early, late } = await history();
      await logWorkout(db, user, { startedAt: day(2), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 70 }] }] });
      await rebuild(user, [bench]);
      // The early workout keeps a warm-up so the delete is not refused as emptying it.
      const [earlyCard] = await cardsOf(early.workoutId);
      await repo().createSet(user, earlyCard!, { setType: "warmup", reps: 5, weight: 20, weightUnit: "kg", isComplete: true });
      await repo().deleteSet(user, early.setIds[0]![0]!);
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(late.setIds[0]![0]);
      await expectEqualsRebuild(user, [bench]);
    });

    it("Review Focus 3 — demoting the record set to a warm-up hands the record on", async () => {
      const { user, bench, early, late } = await history();
      await repo().updateSet(user, early.setIds[0]![0]!, { setType: "warmup" });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(late.setIds[0]![0]);
      await expectEqualsRebuild(user, [bench]);
    });

    it("Review Focus 5 — the record set's unit kg → lb recomputes in kg", async () => {
      const { user, bench, early, late } = await history();
      // 100 lb ≈ 45.359 kg: the 90 kg set on the later day now holds the record.
      await repo().updateSet(user, early.setIds[0]![0]!, { weightUnit: "lb" });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(late.setIds[0]![0]);
      expect((await heaviest(user, bench))?.value).toBe("90.000");
      await expectEqualsRebuild(user, [bench]);
    });

    it("Review Focus 1 — a set on a forked exercise recomputes the lineage root", async () => {
      const user = await insertUser(db);
      const root = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: user, forkedFrom: root });
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: fork, sets: [{ reps: 5, weight: 100 }] }] });
      await rebuild(user, [root]);
      const [card] = await cardsOf(w.workoutId);
      const { set } = await repo().createSet(user, card!, { reps: 5, weight: 120, weightUnit: "kg", isComplete: true });
      const row = await heaviest(user, root);
      expect(row?.source_set_entry_id).toBe(set.id);
      await expectEqualsRebuild(user, [root]);
    });
  });

  describe("07.4 AC8 — edits that cannot affect records recompute nothing", () => {
    it("an rpe-only patch and a warm-up create leave the records untouched and report no recompute", async () => {
      const { user, early, lateCard } = await history();
      const before = await recordsOf(db, user);
      const patched = await repo().updateSet(user, early.setIds[0]![0]!, { rpe: 8 });
      expect(patched.finishedEdit).toMatchObject({ recordsRecomputed: false, rootCount: 0 });
      const warm = await repo().createSet(user, lateCard, { setType: "warmup", reps: 5, weight: 20, weightUnit: "kg", isComplete: true });
      expect(warm.finishedEdit).toMatchObject({ recordsRecomputed: false });
      expect(await recordsOf(db, user)).toEqual(before);
    });
  });

  describe("05.3 AC29 — finished edits follow the set's modality", () => {
    it("a calories change on a calories set recomputes its lineage", async () => {
      const user = await insertUser(db);
      const bike = await insertExercise(db, { modality: "calories" });
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bike, modality: "calories", sets: [{ calories: 20 }] }] });
      await rebuild(user, [bike]);
      const patched = await repo().updateSet(user, w.setIds[0]![0]!, { calories: 30 });
      expect(patched.finishedEdit).toMatchObject({ recordsRecomputed: true, rootCount: 1 });
      await expectEqualsRebuild(user, [bike]);
    });

    it("an rpe-only patch and a legacy distance_duration distance patch recompute nothing", async () => {
      const user = await insertUser(db);
      const row = await insertExercise(db, { modality: "distance_duration" });
      const w = await logWorkout(db, user, {
        startedAt: day(1),
        exercises: [{ exerciseId: row, modality: "distance_duration", sets: [{ distance: 5000, durationS: 1500 }] }],
      });
      await rebuild(user, [row]);
      const before = await recordsOf(db, user);
      const rpe = await repo().updateSet(user, w.setIds[0]![0]!, { rpe: 8 });
      expect(rpe.finishedEdit).toMatchObject({ recordsRecomputed: false, rootCount: 0 });
      const dist = await repo().updateSet(user, w.setIds[0]![0]!, { distance: 6000 });
      expect(dist.set.distanceM).toBe(6000);
      expect(dist.finishedEdit).toMatchObject({ recordsRecomputed: false, rootCount: 0 });
      expect(await recordsOf(db, user)).toEqual(before);
    });
  });

  describe("07.4 AC9 — finished-mode integrity", () => {
    it("a working set without reps is a ValidationError naming reps; nothing is written", async () => {
      const { user, late, lateCard } = await history();
      await expect(repo().createSet(user, lateCard, { weight: 100, weightUnit: "kg" })).rejects.toMatchObject({
        fieldErrors: [{ path: "reps", message: "required on a finished workout" }],
      });
      expect((await cardsOf(late.workoutId)).length).toBe(1);
      const n = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "set_entry" WHERE workout_exercise_id = $1::uuid`, lateCard);
      expect(n[0]!.n).toBe(2);
      await expect(repo().createSet(user, lateCard, { weight: 100, weightUnit: "kg" })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("07.4 AC13 — completed_at stays inside the span", () => {
    it("a set created complete days later is stamped at the workout's end; flip and clear behave", async () => {
      const { user, late, lateCard } = await history();
      const endedAt = new Date(day(3).getTime() + 3_600_000);
      const { set } = await repo().createSet(user, lateCard, { setType: "warmup", reps: 5, weight: 20, weightUnit: "kg", isComplete: true });
      expect(set.completedAt).toEqual(endedAt);
      const open = (await repo().createSet(user, lateCard, { setType: "warmup", reps: 5, weight: 20, weightUnit: "kg" })).set;
      expect(open.completedAt).toBeNull();
      const flipped = (await repo().updateSet(user, open.id, { isComplete: true })).set;
      expect(flipped.completedAt).toEqual(endedAt);
      expect((await repo().updateSet(user, open.id, { isComplete: true, reps: 6 })).set.completedAt).toEqual(endedAt);
      expect((await repo().updateSet(user, open.id, { isComplete: false })).set.completedAt).toBeNull();
      expect(late.workoutId).toBeDefined();
    });

    it("a workout whose start is after now (moved by hand) stamps the start, not now", async () => {
      const { user, late, lateCard } = await history();
      const future = new Date(Date.now() + 86_400_000);
      await db.prisma.$executeRawUnsafe(
        `UPDATE "workout" SET started_at = $2, ended_at = $3 WHERE id = $1::uuid`, late.workoutId, future, new Date(future.getTime() + 3_600_000));
      const { set } = await repo().createSet(user, lateCard, { setType: "warmup", reps: 5, weight: 20, weightUnit: "kg", isComplete: true });
      expect(set.completedAt).toEqual(future);
    });
  });

  describe("07.4 AC14 — create idempotency on a finished workout", () => {
    it("a key first sent while live and replayed after the finish answers the stored row", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(5), finish: "none", exercises: [{ exerciseId: bench, sets: [] }] });
      const [card] = await cardsOf(w.workoutId);
      const key = uuidv7();
      const first = await repo().createSet(user, card!, { clientGeneratedId: key, reps: 5, weight: 60, weightUnit: "kg", isComplete: true });
      await repo().updateWorkout(user, w.workoutId, { endedAt: new Date(day(5).getTime() + 3_600_000).toISOString() });
      const replay = await repo().createSet(user, card!, { clientGeneratedId: key, reps: 5, weight: 60, weightUnit: "kg", isComplete: true });
      expect(replay.created).toBe(false);
      expect(replay.set.id).toBe(first.set.id);
      expect(replay.finishedEdit).toBeNull();
    });
  });

  describe("07.4 AC10 — the server refuses to empty a finished workout", () => {
    it("deleting the only set is 409 workout-would-be-empty and changes nothing", async () => {
      const { user, early } = await history();
      await expect(repo().deleteSet(user, early.setIds[0]![0]!)).rejects.toBeInstanceOf(WorkoutWouldBeEmptyError);
      const n = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "set_entry" WHERE id = $1::uuid`, early.setIds[0]![0]);
      expect(n[0]!.n).toBe(1);
    });

    it("deleting one of two succeeds; a live workout may delete its last set", async () => {
      const { user, late } = await history();
      await expect(repo().deleteSet(user, late.setIds[0]![1]!)).resolves.toMatchObject({ finishedEdit: { recordsRecomputed: false } });
      const bench = await insertExercise(db);
      const live = await logWorkout(db, user, { startedAt: day(6), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] });
      await expect(repo().deleteSet(user, live.setIds[0]![0]!)).resolves.toEqual({ finishedEdit: null });
    });
  });
});
