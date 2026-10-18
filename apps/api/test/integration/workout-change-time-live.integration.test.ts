// Spec 07.4 Phase B — Change Time on a live workout, and finishing with a plan (real Postgres).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const HOUR = 3_600_000;

describe.skipIf(!shouldRunIntegration())("Spec 07.4 Phase B — Change Time on a live workout", () => {
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
  async function liveWorkout(startedAt = new Date(Date.now() - HOUR), sets = 2) {
    const user = await insertUser(db);
    const exerciseId = await insertExercise(db);
    const w = await logWorkout(db, user, {
      startedAt, finish: "none",
      exercises: [{ exerciseId, sets: Array.from({ length: sets }, () => ({ reps: 5, weight: 60 })) }],
    });
    return { user, ...w };
  }
  const row = async (id: string) =>
    (await db.prisma.$queryRawUnsafe<{ local_date: Date; tz_offset_minutes: number; planned_duration_s: number | null; started_at: Date; ended_at: Date | null }[]>(
      `SELECT local_date, tz_offset_minutes, planned_duration_s, started_at, ended_at FROM "workout" WHERE id = $1::uuid`, id))[0]!;
  const setTimes = async (workoutId: string) =>
    db.prisma.$queryRawUnsafe<{ id: string; completed_at: Date | null; updated_at: Date }[]>(
      `SELECT se.id::text, se.completed_at, se.updated_at FROM "set_entry" se JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
       WHERE we.workout_id = $1::uuid ORDER BY se.set_number`, workoutId);
  const stamp = (setId: string, at: Date | null) =>
    db.prisma.$executeRawUnsafe(`UPDATE "set_entry" SET completed_at = $2, is_complete = $3 WHERE id = $1::uuid`, setId, at, at !== null);

  describe("07.4 AC20 / AC24 — a live start move re-derives the calendar day; sets are untouched", () => {
    it("a sent offset decides the local day (23:30 at UTC−5 is the previous UTC date)", async () => {
      const w = await liveWorkout();
      const result = await repo().updateWorkout(w.user, w.workoutId, { startedAt: "2026-10-14T04:30:00.000Z", tzOffsetMinutes: -300 });
      expect(result.workout).toMatchObject({ localDate: "2026-10-13", tzOffsetMinutes: -300 });
      expect(result.finishedEdit).toBeNull();
    });

    it("without an offset the profile zone at the new instant is used, DST included", async () => {
      const w = await liveWorkout();
      await db.prisma.$executeRawUnsafe(`UPDATE "user" SET timezone = 'America/Chicago' WHERE id = $1::uuid`, w.user);
      const before = await repo().updateWorkout(w.user, w.workoutId, { startedAt: "2026-03-08T07:30:00.000Z" });
      expect(before.workout).toMatchObject({ tzOffsetMinutes: -360, localDate: "2026-03-08" });
      const after = await repo().updateWorkout(w.user, w.workoutId, { startedAt: "2026-03-08T08:30:00.000Z" });
      expect(after.workout).toMatchObject({ tzOffsetMinutes: -300, localDate: "2026-03-08" });
    });

    it("a live move leaves every set's completed_at as it was", async () => {
      const w = await liveWorkout();
      await stamp(w.setIds[0]![0]!, new Date(Date.now() - 30 * 60_000));
      const before = await setTimes(w.workoutId);
      await repo().updateWorkout(w.user, w.workoutId, { startedAt: new Date(Date.now() - 5 * HOUR).toISOString() });
      expect(await setTimes(w.workoutId)).toEqual(before);
    });

    it("durationSeconds stores the plan and null clears it", async () => {
      const w = await liveWorkout(new Date(Date.now() - 2 * HOUR));
      expect((await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 3600 })).workout.plannedDurationS).toBe(3600);
      expect((await row(w.workoutId)).planned_duration_s).toBe(3600);
      expect((await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: null })).workout.plannedDurationS).toBeNull();
    });

    it("a plan ending in the future is 422 on durationSeconds and nothing is stored", async () => {
      const w = await liveWorkout(new Date(Date.now() - 30 * 60_000));
      await expect(repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 3600 })).rejects.toBeInstanceOf(ValidationError);
      expect((await row(w.workoutId)).planned_duration_s).toBeNull();
    });

    it("Review Focus 4 — an echoed start with an offset changes neither local_date nor tz_offset_minutes", async () => {
      const w = await liveWorkout();
      const stored = await row(w.workoutId);
      await repo().updateWorkout(w.user, w.workoutId, { startedAt: stored.started_at.toISOString(), tzOffsetMinutes: 600 });
      const after = await row(w.workoutId);
      expect(after.tz_offset_minutes).toBe(stored.tz_offset_minutes);
      expect(after.local_date).toEqual(stored.local_date);
    });

    it("Review Focus 3 — moving the start so the stored plan ends in the future is 422 on startedAt", async () => {
      const w = await liveWorkout(new Date(Date.now() - 2 * HOUR));
      await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 3600 });
      const err = await repo().updateWorkout(w.user, w.workoutId, { startedAt: new Date(Date.now() - 30 * 60_000).toISOString() }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual([{ path: "startedAt", message: "would end in the future" }]);
    });
  });

  describe("07.4 AC21 — finishing with a plan", () => {
    it("the client's endedAt = start + plan finishes it; the plan is cleared and the duration is exact", async () => {
      const startedAt = new Date(Date.now() - 2 * HOUR);
      const w = await liveWorkout(startedAt);
      await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 2700 });
      const done = await repo().updateWorkout(w.user, w.workoutId, { endedAt: new Date(startedAt.getTime() + 2700_000).toISOString() });
      expect(done.workout.plannedDurationS).toBeNull();
      expect(done.hadPlannedDuration).toBe(true);
      const stored = await row(w.workoutId);
      expect(stored.planned_duration_s).toBeNull();
      expect(stored.ended_at!.getTime() - stored.started_at.getTime()).toBe(2700_000);
    });

    it("Review Focus 3 — a stale device's different endedAt is accepted and still clears the plan", async () => {
      const startedAt = new Date(Date.now() - 2 * HOUR);
      const w = await liveWorkout(startedAt);
      await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 2700 });
      const end = new Date(Date.now() - 60_000);
      const done = await repo().updateWorkout(w.user, w.workoutId, { endedAt: end.toISOString() });
      expect(done.workout.endedAt).toEqual(end);
      expect((await row(w.workoutId)).planned_duration_s).toBeNull();
    });

    it("a finish without a plan reports hadPlannedDuration false", async () => {
      const w = await liveWorkout();
      expect((await repo().updateWorkout(w.user, w.workoutId, { endedAt: new Date().toISOString() })).hadPlannedDuration).toBe(false);
    });

    it("07.4 AC25 — the finish clamps out-of-span set times into [started_at, ended_at]; NULL stays NULL; updated_at untouched", async () => {
      const startedAt = new Date(Date.now() - 26 * HOUR); // a forgotten workout, logged "today"
      const w = await liveWorkout(startedAt, 3);
      await stamp(w.setIds[0]![0]!, new Date(startedAt.getTime() - 60_000)); // before the start
      await stamp(w.setIds[0]![1]!, new Date(Date.now() - 60_000)); // today, after the planned end
      const before = await setTimes(w.workoutId);
      const end = new Date(startedAt.getTime() + HOUR);
      await repo().updateWorkout(w.user, w.workoutId, { endedAt: end.toISOString() });
      const after = await setTimes(w.workoutId);
      expect(after.map((s) => s.completed_at?.getTime() ?? null)).toEqual([startedAt.getTime(), end.getTime(), null]);
      expect(after.map((s) => s.updated_at)).toEqual(before.map((s) => s.updated_at));
    });
  });
});
