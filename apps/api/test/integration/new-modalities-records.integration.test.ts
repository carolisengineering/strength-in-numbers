import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL, type RecordRow, type SetSpec } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));
const endOf = (d: number) => new Date(Date.UTC(2026, 9, d, 11)).toISOString();
/** Comparable view of a row — a row's own id is not stable (07.0 D15). */
const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, unit, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id, record_type, value, unit, previous_value, source_set_entry_id, workout_id,
  }));
const silent = pino({ level: "silent" });

/**
 * Spec 05.3 Phase B against a real Postgres: the loader reads calories, distance and duration, and
 * every record path (finish, delete, rebuild, finished edits) produces the new record types.
 */
describe.skipIf(!shouldRunIntegration())("Spec 05.3 Phase B — records for the new types (real Postgres)", () => {
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

  async function expectEqualsRebuild(userId: string, roots: string[]) {
    const live = shape(await recordsOf(db, userId));
    await db.prisma.$transaction(async (tx) => {
      await lockUserRecords(tx, userId);
      await recomputeRecordsForRoots(tx, userId, roots);
    });
    expect(shape(await recordsOf(db, userId))).toEqual(live);
  }

  /** Logs one in-progress workout on day `d` with one card, then finishes it through the repository. */
  async function finishOne(user: string, d: number, exerciseId: string, modality: string, sets: SetSpec[]) {
    const w = await logWorkout(db, user, { startedAt: day(d), finish: "none", exercises: [{ exerciseId, modality, sets }] });
    const result = await repo().updateWorkout(user, w.workoutId, { endedAt: endOf(d) });
    return { ...w, result };
  }

  describe("05.3 AC27 — persistence is exact and fits", () => {
    it("writes max_calories 20.000 cal, max_distance 40.000 m, max_duration 90.000 s and heaviest_weight", async () => {
      const user = await insertUser(db);
      const bike = await insertExercise(db, { modality: "calories" });
      const sled = await insertExercise(db, { modality: "weight_distance" });
      const hold = await insertExercise(db, { modality: "weight_duration" });
      const w = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [
          { exerciseId: bike, modality: "calories", sets: [{ calories: 20 }] },
          { exerciseId: sled, modality: "weight_distance", sets: [{ weight: 24, distance: 40 }] },
          { exerciseId: hold, modality: "weight_duration", sets: [{ weight: 20, durationS: 90 }] },
        ],
      });
      await repo().updateWorkout(user, w.workoutId, { endedAt: endOf(1) });
      const rows = (await recordsOf(db, user)).map((r) => [r.exercise_id, r.record_type, r.value, r.unit]);
      expect(rows).toEqual(
        expect.arrayContaining([
          [bike, "max_calories", "20.000", "cal"],
          [sled, "heaviest_weight", "24.000", "kg"],
          [sled, "max_distance", "40.000", "m"],
          [hold, "heaviest_weight", "20.000", "kg"],
          [hold, "max_duration", "90.000", "s"],
        ]),
      );
      expect(rows).toHaveLength(5);
    });

    it("a distance typed in feet records canonical meters", async () => {
      const user = await insertUser(db);
      const sled = await insertExercise(db, { modality: "weight_distance" });
      await finishOne(user, 1, sled, "weight_distance", [{ weight: 24, distance: 100, distanceUnit: "ft" }]);
      expect((await recordsOf(db, user)).find((r) => r.record_type === "max_distance")).toMatchObject({ value: "30.480", unit: "m" });
    });

    it("a weight_duration set of 2147483647 seconds finishes and records exactly", async () => {
      const user = await insertUser(db);
      const hold = await insertExercise(db, { modality: "weight_duration" });
      await finishOne(user, 1, hold, "weight_duration", [{ weight: 20, durationS: 2_147_483_647 }]);
      expect((await recordsOf(db, user)).find((r) => r.record_type === "max_duration")).toMatchObject({ value: "2147483647.000", unit: "s" });
    });

    it("the database rejects a mismatched type/unit pair", async () => {
      const user = await insertUser(db);
      const bike = await insertExercise(db, { modality: "calories" });
      const { workoutId, setIds } = await finishOne(user, 1, bike, "calories", [{ calories: 20 }]);
      await expect(
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "personal_record" ("id","user_id","exercise_id","record_type","value","unit","source_set_entry_id","workout_id","achieved_at","local_date")
           VALUES ($1::uuid,$2::uuid,$3::uuid,'max_calories',20,'kg',$4::uuid,$5::uuid,now(),current_date)`,
          uuidv7(), user, bike, setIds[0]![0]!, workoutId,
        ),
      ).rejects.toThrow(/personal_record_type_unit_check/);
    });
  });

  describe("05.3 AC28 — recompute paths", () => {
    it("deleting the holding workout moves the record to the next best", async () => {
      const user = await insertUser(db);
      const bike = await insertExercise(db, { modality: "calories" });
      const a = await finishOne(user, 1, bike, "calories", [{ calories: 20 }]);
      const b = await finishOne(user, 2, bike, "calories", [{ calories: 30 }]);
      expect((await recordsOf(db, user))[0]).toMatchObject({ value: "30.000", previous_value: "20.000", workout_id: b.workoutId });
      await repo().deleteWorkout(user, b.workoutId);
      expect(await recordsOf(db, user)).toEqual([
        expect.objectContaining({ record_type: "max_calories", value: "20.000", previous_value: null, workout_id: a.workoutId }),
      ]);
    });

    it("the finish result's newRecords carry the new types with the right previous value", async () => {
      const user = await insertUser(db);
      const hold = await insertExercise(db, { modality: "weight_duration" });
      await finishOne(user, 1, hold, "weight_duration", [{ weight: 20, durationS: 60 }]);
      const later = await finishOne(user, 2, hold, "weight_duration", [{ weight: 16, durationS: 90 }]);
      if (!("newRecords" in later.result)) throw new Error("expected a finish result");
      expect(later.result.newRecords.map((r) => [r.recordType, r.value, r.previousValue])).toEqual([["max_duration", 90, 60]]);
    });

    it("records:rebuild (all users, then --user) equals the live rows; a second run is a no-op", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      for (const user of [a, b]) {
        const bike = await insertExercise(db, { modality: "calories" });
        const sled = await insertExercise(db, { modality: "weight_distance" });
        await finishOne(user, 1, bike, "calories", [{ calories: 20 }]);
        await finishOne(user, 2, sled, "weight_distance", [{ weight: 24, distance: 40 }, { weight: 40, distance: 20 }]);
        await finishOne(user, 3, bike, "calories", [{ calories: 25 }]);
      }
      const liveA = shape(await recordsOf(db, a));
      const liveB = shape(await recordsOf(db, b));
      expect(liveA).toHaveLength(3);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
      await rebuildRecords(db.prisma, silent, {});
      expect(shape(await recordsOf(db, a))).toEqual(liveA);
      expect(shape(await recordsOf(db, b))).toEqual(liveB);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
      await rebuildRecords(db.prisma, silent, { userId: a });
      expect(shape(await recordsOf(db, a))).toEqual(liveA);
      expect(await recordsOf(db, b)).toEqual([]);
      await rebuildRecords(db.prisma, silent, {});
      await rebuildRecords(db.prisma, silent, {});
      expect(shape(await recordsOf(db, a))).toEqual(liveA);
      expect(shape(await recordsOf(db, b))).toEqual(liveB);
    });

    it("Review Focus 2 — a lineage logged as duration, then weight_duration, takes max_duration only from the second", async () => {
      const user = await insertUser(db);
      const hold = await insertExercise(db, { modality: "duration" });
      await finishOne(user, 1, hold, "duration", [{ durationS: 600 }]);
      await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET modality = 'weight_duration' WHERE id = $1::uuid`, hold);
      const later = await finishOne(user, 2, hold, "weight_duration", [{ weight: 20, durationS: 90 }]);
      const rows = await recordsOf(db, user);
      expect(rows.map((r) => [r.record_type, r.value, r.previous_value, r.workout_id])).toEqual([
        ["heaviest_weight", "20.000", null, later.workoutId],
        ["max_duration", "90.000", null, later.workoutId],
      ]);
    });
  });

  describe("05.3 AC29 — a finished calories edit writes the new value", () => {
    it("calories 20 → 30 on the record set restates the record", async () => {
      const user = await insertUser(db);
      const bike = await insertExercise(db, { modality: "calories" });
      const w = await finishOne(user, 1, bike, "calories", [{ calories: 20 }]);
      await repo().updateSet(user, w.setIds[0]![0]!, { calories: 30 });
      expect((await recordsOf(db, user))[0]).toMatchObject({ record_type: "max_calories", value: "30.000" });
    });
  });

  describe("05.3 AC30 — lock order holds for the new types", () => {
    it("a calories finish racing a finished-mode calories edit in the same lineage ends serially", async () => {
      for (let i = 0; i < 10; i++) {
        const user = await insertUser(db);
        const bike = await insertExercise(db, { modality: "calories" });
        const done = await finishOne(user, 1, bike, "calories", [{ calories: 20 }]);
        const live = await logWorkout(db, user, { startedAt: day(2), finish: "none", exercises: [{ exerciseId: bike, modality: "calories", sets: [{ calories: 25 }] }] });
        const results = await Promise.allSettled([
          repo().updateWorkout(user, live.workoutId, { endedAt: endOf(2) }),
          repo().updateSet(user, done.setIds[0]![0]!, { calories: 40 }),
        ]);
        for (const r of results) {
          if (r.status === "rejected") expect(String(r.reason)).not.toMatch(/40P01|deadlock/i);
        }
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
        expect((await recordsOf(db, user))[0]).toMatchObject({ value: "40.000", workout_id: done.workoutId });
        await expectEqualsRebuild(user, [bike]);
      }
    });
  });
});
