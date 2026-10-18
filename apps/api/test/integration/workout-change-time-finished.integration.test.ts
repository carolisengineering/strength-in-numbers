// Spec 07.4 Phase B — Change Time on a finished workout (real Postgres): the end follows the start,
// set times shift by Δ and are clamped into the span, records recompute on a start change.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository, lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow } from "./records-helpers.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const day = (d: number) => new Date(Date.UTC(2026, 8, d, 10)); // Sept 2026, 10:00Z
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id,
  }));

describe.skipIf(!shouldRunIntegration())("Spec 07.4 Phase B — Change Time on a finished workout", () => {
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
  const row = async (id: string) =>
    (await db.prisma.$queryRawUnsafe<{ started_at: Date; ended_at: Date; local_date: Date; planned_duration_s: number | null; updated_at: Date }[]>(
      `SELECT started_at, ended_at, local_date, planned_duration_s, updated_at FROM "workout" WHERE id = $1::uuid`, id))[0]!;
  const setRows = async (workoutId: string) =>
    db.prisma.$queryRawUnsafe<{ id: string; completed_at: Date | null; updated_at: Date }[]>(
      `SELECT se.id::text, se.completed_at, se.updated_at FROM "set_entry" se JOIN "workout_exercise" we ON we.id = se.workout_exercise_id
       WHERE we.workout_id = $1::uuid ORDER BY we.position, se.set_number`, workoutId);
  const stamp = (setId: string, at: Date) =>
    db.prisma.$executeRawUnsafe(`UPDATE "set_entry" SET completed_at = $2, is_complete = true WHERE id = $1::uuid`, setId, at);

  /** A finished workout on `day(d)` (1 h) with four sets: three stamped 10, 20, 30 min in, the last NULL. */
  async function finishedWithTimes(d = 5) {
    const user = await insertUser(db);
    const bench = await insertExercise(db);
    const w = await logWorkout(db, user, {
      startedAt: day(d),
      exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 90 }, { reps: 5, weight: 80 }, { reps: 5, weight: 70 }] }],
    });
    for (const [i, m] of [10, 20, 30].entries()) await stamp(w.setIds[0]![i]!, new Date(day(d).getTime() + m * MIN));
    return { user, bench, ...w };
  }

  describe("07.4 AC22 — the end follows the start; a duration sets the end", () => {
    it("startedAt alone keeps the duration; durationSeconds alone sets end = start + n; both together set both", async () => {
      const w = await finishedWithTimes();
      const moved = await repo().updateWorkout(w.user, w.workoutId, { startedAt: day(4).toISOString() });
      expect(moved.workout.startedAt).toEqual(day(4));
      expect(moved.workout.endedAt).toEqual(new Date(day(4).getTime() + HOUR));
      expect(moved.workout.localDate).toBe("2026-09-04");
      expect(moved.workout.plannedDurationS).toBeNull();

      const shorter = await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 1800 });
      expect(shorter.workout.endedAt).toEqual(new Date(day(4).getTime() + 30 * MIN));

      const both = await repo().updateWorkout(w.user, w.workoutId, { startedAt: day(3).toISOString(), durationSeconds: 0 });
      expect(both.workout.startedAt).toEqual(day(3));
      expect(both.workout.endedAt).toEqual(day(3));
    });

    it("durationSeconds: null is 422 and nothing changes", async () => {
      const w = await finishedWithTimes();
      const before = await row(w.workoutId);
      await expect(repo().updateWorkout(w.user, w.workoutId, { durationSeconds: null })).rejects.toBeInstanceOf(ValidationError);
      expect(await row(w.workoutId)).toEqual(before);
    });
  });

  describe("07.4 AC25 — set times move with the workout and stay inside its span", () => {
    it("a start moved back a day shifts every stamped set by the same Δ; NULL stays NULL; updated_at is untouched", async () => {
      const w = await finishedWithTimes(5);
      const before = await setRows(w.workoutId);
      await repo().updateWorkout(w.user, w.workoutId, { startedAt: day(4).toISOString() });
      const after = await setRows(w.workoutId);
      expect(after.map((s) => s.completed_at?.getTime() ?? null)).toEqual(before.map((s) => (s.completed_at ? s.completed_at.getTime() - DAY : null)));
      expect(after.map((s) => s.updated_at)).toEqual(before.map((s) => s.updated_at));
    });

    it("a duration-only shrink collapses later sets onto the new end", async () => {
      const w = await finishedWithTimes(5);
      await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 15 * 60 });
      const end = day(5).getTime() + 15 * MIN;
      expect((await setRows(w.workoutId)).map((s) => s.completed_at?.getTime() ?? null)).toEqual([day(5).getTime() + 10 * MIN, end, end, null]);
    });

    it("Review Focus 2 — start moved later and duration shortened in one PATCH: every stamped set lands inside the new span", async () => {
      const w = await finishedWithTimes(5);
      const start = new Date(day(5).getTime() + 2 * HOUR);
      await repo().updateWorkout(w.user, w.workoutId, { startedAt: start.toISOString(), durationSeconds: 15 * 60 });
      const r = await row(w.workoutId);
      const times = (await setRows(w.workoutId)).map((s) => s.completed_at);
      expect(times[3]).toBeNull();
      for (const t of times.slice(0, 3)) {
        expect(t!.getTime()).toBeGreaterThanOrEqual(r.started_at.getTime());
        expect(t!.getTime()).toBeLessThanOrEqual(r.ended_at.getTime());
      }
    });
  });

  describe("07.4 AC26 — records follow a re-time", () => {
    it("a workout moved before an equally heavy one takes the tied record; held rows carry the new date; the table equals a rebuild", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const b = await logWorkout(db, user, { startedAt: day(3), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      const a = await logWorkout(db, user, { startedAt: day(5), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      await rebuild(user, [bench]);
      const heaviest = async () => (await recordsOf(db, user)).find((r) => r.exercise_id === bench && r.record_type === "heaviest_weight")!;
      expect((await heaviest()).workout_id).toBe(b.workoutId);

      const result = await repo().updateWorkout(user, a.workoutId, { startedAt: day(1).toISOString() });
      expect(result.retime).toMatchObject({ wasFinished: true, recordsRecomputed: true, startShiftSeconds: -4 * 86_400 });
      const held = await heaviest();
      expect(held.workout_id).toBe(a.workoutId);
      expect(held.source_set_entry_id).toBe(a.setIds[0]![0]);
      const dates = await db.prisma.$queryRawUnsafe<{ achieved_at: Date; local_date: Date }[]>(
        `SELECT achieved_at, local_date FROM "personal_record" WHERE workout_id = $1::uuid LIMIT 1`, a.workoutId);
      expect(dates[0]!.achieved_at).toEqual(day(1));
      expect(dates[0]!.local_date.toISOString().slice(0, 10)).toBe("2026-09-01");
      await expectEqualsRebuild(user, [bench]);
    });

    it("a duration-only change recomputes nothing", async () => {
      const w = await finishedWithTimes();
      await rebuild(w.user, [w.bench]);
      const before = await recordsOf(db, w.user);
      const result = await repo().updateWorkout(w.user, w.workoutId, { durationSeconds: 2400 });
      expect(result.retime).toMatchObject({ wasFinished: true, recordsRecomputed: false, startShiftSeconds: null, durationSeconds: 2400 });
      expect(await recordsOf(db, w.user)).toEqual(before);
    });

    it("Review Focus 5 — a legacy finished workout with no sets re-times without a recompute", async () => {
      const user = await insertUser(db);
      const w = await logWorkout(db, user, { startedAt: day(5), exercises: [] });
      const result = await repo().updateWorkout(user, w.workoutId, { startedAt: day(2).toISOString() });
      expect(result.workout.startedAt).toEqual(day(2));
      expect(result.retime).toMatchObject({ recordsRecomputed: false });
    });
  });

  describe("07.4 AC28 — overlap allowed; the one-active rule is untouched", () => {
    it("a span overlapping another finished workout succeeds; re-timing while another workout is live succeeds", async () => {
      const w = await finishedWithTimes(5);
      const other = await logWorkout(db, w.user, { startedAt: day(4), exercises: [] });
      const live = await logWorkout(db, w.user, { startedAt: new Date(Date.now() - HOUR), finish: "none", exercises: [] });
      const overlap = new Date(day(4).getTime() + 30 * MIN).toISOString();
      await expect(repo().updateWorkout(w.user, w.workoutId, { startedAt: overlap })).resolves.toMatchObject({ workout: { startedAt: new Date(overlap) } });
      expect((await row(other.workoutId)).started_at).toEqual(day(4));
      expect((await repo().getActiveWorkout(w.user)).id).toBe(live.workoutId);
    });
  });

  describe("07.4 AC29 — the same Change Time twice leaves the data as after the first", () => {
    it("Δ is computed from the stored start, so a replay shifts nothing", async () => {
      const w = await finishedWithTimes(5);
      const body = { startedAt: day(2).toISOString() };
      await repo().updateWorkout(w.user, w.workoutId, body);
      const sets1 = (await setRows(w.workoutId)).map((s) => s.completed_at);
      const w1 = await row(w.workoutId);
      const replay = await repo().updateWorkout(w.user, w.workoutId, body);
      expect(replay.retime).toMatchObject({ startShiftSeconds: null, recordsRecomputed: false });
      expect((await setRows(w.workoutId)).map((s) => s.completed_at)).toEqual(sets1);
      const w2 = await row(w.workoutId);
      expect({ ...w2, updated_at: null }).toEqual({ ...w1, updated_at: null });
    });
  });

  describe("07.4 AC27 — History and Progress follow a re-time", () => {
    it("the list shows the workout at its new place with the new localDate; an old cursor still pages in order; a fresh paging lists it once", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const ids: string[] = [];
      for (let d = 1; d <= 10; d++) {
        ids.push((await logWorkout(db, user, { startedAt: day(d), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 50 + d }] }] })).workoutId);
      }
      const moving = ids[9]!; // day 10, newest
      const list = (cursor?: string, limit = 3) => repo().listFinishedWorkouts(user, { limit, cursor });
      const p1 = await list(); // days 10, 9, 8
      await repo().updateWorkout(user, moving, { startedAt: new Date(day(2).getTime() + HOUR).toISOString() });

      const rest: { id: string; startedAt: Date }[] = [];
      for (let cursor: string | null = p1.next; cursor !== null;) {
        const page = await list(cursor);
        rest.push(...page.items.map((i) => ({ id: i.id, startedAt: i.startedAt })));
        cursor = page.next;
      }
      for (let i = 1; i < rest.length; i++) expect(rest[i - 1]!.startedAt.getTime()).toBeGreaterThanOrEqual(rest[i]!.startedAt.getTime());

      const fresh = (await list(undefined, 50)).items;
      expect(fresh.filter((i) => i.id === moving)).toHaveLength(1);
      const at = fresh.findIndex((i) => i.id === moving);
      expect(fresh[at]!.localDate).toBe("2026-09-02");
      expect(fresh[at - 1]!.id).toBe(ids[2]); // day 3 sits just above it
      expect(fresh[at + 1]!.id).toBe(ids[1]); // day 2 just below

      const points = (await createPersonalRecordRepository(db.prisma).getProgressSeries(user, bench, {})).points;
      const point = points.find((p) => p.workoutId === moving)!;
      expect(point.localDate).toBe("2026-09-02");
      expect(points.map((p) => p.workoutId).indexOf(moving)).toBe(2); // after days 1 and 2
    });
  });
});
