// Spec 07.4 Phase A — workout-exercise writes and title/notes on a finished workout, real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError, WorkoutWouldBeEmptyError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 18));
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id,
  }));

describe.skipIf(!shouldRunIntegration())("Spec 07.4 Phase A — exercise writes on a finished workout", () => {
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
  async function expectEqualsRebuild(userId: string, roots: string[]) {
    const live = shape(await recordsOf(db, userId));
    await rebuild(userId, roots);
    expect(shape(await recordsOf(db, userId))).toEqual(live);
  }
  async function cards(workoutId: string): Promise<{ id: string; position: number }[]> {
    return db.prisma.$queryRawUnsafe(`SELECT id::text, position FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
  }
  const heaviest = async (userId: string, root: string) =>
    (await recordsOf(db, userId)).find((r) => r.exercise_id === root && r.record_type === "heaviest_weight");

  describe("07.4 AC2 — exercise writes open on a finished workout; positions stay dense", () => {
    it("add (at a position), reorder and delete succeed and leave 0…n-1", async () => {
      const user = await insertUser(db);
      const [a, b, c] = [await insertExercise(db), await insertExercise(db), await insertExercise(db)];
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: a, sets: [{ reps: 5, weight: 50 }] }, { exerciseId: b, sets: [{ reps: 5, weight: 60 }] }] });
      const added = await repo().addWorkoutExercise(user, w.workoutId, { exerciseId: c, position: 0 });
      expect(added.finishedEdit).toMatchObject({ recordsRecomputed: false });
      await repo().updateWorkoutExercise(user, added.id, { position: 2 });
      await repo().deleteWorkoutExercise(user, added.id);
      expect((await cards(w.workoutId)).map((r) => r.position)).toEqual([0, 1]);
    });
  });

  describe("07.4 AC3 — title/notes on a finished workout", () => {
    it("title and notes are written; the workout stays finished", async () => {
      const user = await insertUser(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: await insertExercise(db), sets: [{ reps: 5, weight: 50 }] }] });
      const result = await repo().updateWorkout(user, w.workoutId, { title: "Heavy day", notes: "felt good" });
      expect(result.workout).toMatchObject({ title: "Heavy day", notes: "felt good" });
      expect(result.workout.endedAt).not.toBeNull();
      expect(result.finishedEdit).toMatchObject({ recordsRecomputed: false });
    });
  });

  describe("07.4 AC7 — records follow exercise edits", () => {
    it("removing a card recomputes its root; the record moves to the next best workout", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const other = await insertExercise(db);
      const best = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: other, sets: [{ reps: 5, weight: 10 }] }] });
      const next = await logWorkout(db, user, { startedAt: day(2), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 90 }] }] });
      await rebuild(user, [bench, other]);
      const [benchCard] = await cards(best.workoutId);
      const result = await repo().deleteWorkoutExercise(user, benchCard!.id);
      expect(result.finishedEdit).toMatchObject({ recordsRecomputed: true, rootCount: 1 });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(next.setIds[0]![0]);
      await expectEqualsRebuild(user, [bench, other]);
    });

    it("reordering two cards of one lineage moves a tied record (position is the tie-break)", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      await rebuild(user, [bench]);
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(w.setIds[0]![0]);
      const [, second] = await cards(w.workoutId);
      const moved = await repo().updateWorkoutExercise(user, second!.id, { position: 0 });
      expect(moved.moved).toBe(true);
      expect(moved.finishedEdit).toMatchObject({ recordsRecomputed: true, rootCount: 1 });
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(w.setIds[1]![0]);
      await expectEqualsRebuild(user, [bench]);
    });

    it("adding a card, a note and a superset edit recompute nothing", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: await insertExercise(db), sets: [{ reps: 5, weight: 50 }] }] });
      await rebuild(user, [bench]);
      const before = await recordsOf(db, user);
      const [first] = await cards(w.workoutId);
      expect((await repo().addWorkoutExercise(user, w.workoutId, { exerciseId: bench })).finishedEdit).toMatchObject({ recordsRecomputed: false });
      expect((await repo().updateWorkoutExercise(user, first!.id, { notes: "paused" })).finishedEdit).toMatchObject({ recordsRecomputed: false });
      expect((await repo().updateWorkoutExercise(user, first!.id, { supersetGroup: 1 })).finishedEdit).toMatchObject({ recordsRecomputed: false });
      expect(await recordsOf(db, user)).toEqual(before);
    });

    it("Review Focus 2 — deleting one of two same-lineage cards keeps the other card's sets counted", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: bench, sets: [{ reps: 5, weight: 80 }] }] });
      await rebuild(user, [bench]);
      const [first] = await cards(w.workoutId);
      await repo().deleteWorkoutExercise(user, first!.id);
      expect((await heaviest(user, bench))?.source_set_entry_id).toBe(w.setIds[1]![0]);
      await expectEqualsRebuild(user, [bench]);
    });
  });

  describe("07.4 AC10 — refusing to empty a finished workout through a card delete", () => {
    it("the last card with sets is 409; an empty card among others is 204", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: await insertExercise(db), sets: [] }] });
      const [withSets, empty] = await cards(w.workoutId);
      await expect(repo().deleteWorkoutExercise(user, withSets!.id)).rejects.toBeInstanceOf(WorkoutWouldBeEmptyError);
      expect(await cards(w.workoutId)).toHaveLength(2);
      await expect(repo().deleteWorkoutExercise(user, empty!.id)).resolves.toMatchObject({ finishedEdit: { recordsRecomputed: false } });
    });

    it("Review Focus 4 — a legacy finished workout with no sets: adding a set and editing the title still work", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [] }] });
      const [card] = await cards(w.workoutId);
      await expect(repo().updateWorkout(user, w.workoutId, { title: "Recovered" })).resolves.toMatchObject({ workout: { title: "Recovered" } });
      const { created } = await repo().createSet(user, card!.id, { reps: 5, weight: 60, weightUnit: "kg", isComplete: true });
      expect(created).toBe(true);
    });
  });

  describe("07.4 AC12 — DELETE /v1/workouts/{id} is unchanged", () => {
    it("a finished workout deletes (records recomputed), a repeat is 404; a live one deletes too", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const w = await logWorkout(db, user, { startedAt: day(1), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      await rebuild(user, [bench]);
      expect((await repo().deleteWorkout(user, w.workoutId)).wasFinished).toBe(true);
      expect(await recordsOf(db, user)).toEqual([]);
      await expect(repo().deleteWorkout(user, w.workoutId)).rejects.toBeInstanceOf(NotFoundError);
      const live = await logWorkout(db, user, { startedAt: day(2), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5 }] }] });
      expect((await repo().deleteWorkout(user, live.workoutId)).wasFinished).toBe(false);
    });
  });
});
