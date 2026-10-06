import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
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
const silent = pino({ level: "silent" });

describe.skipIf(!shouldRunIntegration())("AC22 — records:rebuild reproduces live state", () => {
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

  /** Three sessions of bench + pull-ups, each finished through the live path. */
  async function liveHistory(userId: string) {
    const bench = await insertExercise(db);
    const pullup = await insertExercise(db, { modality: "bodyweight_reps" });
    for (const [d, w, reps] of [
      [1, 100, 5],
      [2, 105, 3],
      [3, 95, 8],
    ] as const) {
      const { workoutId } = await logWorkout(db, userId, {
        startedAt: day(d),
        finish: "none",
        exercises: [
          { exerciseId: bench, sets: [{ reps, weight: w }] },
          { exerciseId: pullup, modality: "bodyweight_reps", sets: [{ reps: 6 + d }] },
        ],
      });
      await repo().updateWorkout(userId, workoutId, { endedAt: endOf(d) });
    }
    return { bench, pullup };
  }

  it("over a live-built database it changes nothing", async () => {
    const user = await insertUser(db);
    await liveHistory(user);
    const before = shape(await recordsOf(db, user));
    expect(before).toHaveLength(4);
    await rebuildRecords(db.prisma, silent, {});
    expect(shape(await recordsOf(db, user))).toEqual(before);
  });

  it("over an empty table it produces the live rows", async () => {
    const user = await insertUser(db);
    await liveHistory(user);
    const live = shape(await recordsOf(db, user));
    await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
    const summary = await rebuildRecords(db.prisma, silent, {});
    expect(shape(await recordsOf(db, user))).toEqual(live);
    expect(summary).toEqual({ users: 1, records: live.length });
  });

  it("removes stale rows for a root that has no qualifying sets", async () => {
    const user = await insertUser(db);
    await liveHistory(user);
    // A stale row (the §11 rollback-window caveat): its root has no sets at all.
    // It borrows a real set/workout id only to satisfy the FKs.
    const orphanRoot = await insertExercise(db);
    const anySet = (await recordsOf(db, user))[0]!;
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "personal_record" ("id","user_id","exercise_id","record_type","value","unit","source_set_entry_id","workout_id","achieved_at","local_date")
       VALUES ($1::uuid,$2::uuid,$3::uuid,'heaviest_weight',999,'kg',$4::uuid,$5::uuid,now(),current_date)`,
      uuidv7(),
      user,
      orphanRoot,
      anySet.source_set_entry_id,
      anySet.workout_id,
    );
    await rebuildRecords(db.prisma, silent, {});
    expect((await recordsOf(db, user)).some((r) => r.exercise_id === orphanRoot)).toBe(false);
  });

  it("--user touches only that user; an unknown id is a no-op", async () => {
    const a = await insertUser(db);
    const b = await insertUser(db);
    await liveHistory(a);
    await liveHistory(b);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
    await rebuildRecords(db.prisma, silent, { userId: a });
    expect((await recordsOf(db, a)).length).toBeGreaterThan(0);
    expect(await recordsOf(db, b)).toEqual([]);
    await expect(rebuildRecords(db.prisma, silent, { userId: uuidv7() })).resolves.toEqual({ users: 0, records: 0 });
  });

  it("a second run is a no-op", async () => {
    const user = await insertUser(db);
    await liveHistory(user);
    await rebuildRecords(db.prisma, silent, {});
    const once = shape(await recordsOf(db, user));
    await rebuildRecords(db.prisma, silent, {});
    expect(shape(await recordsOf(db, user))).toEqual(once);
  });

  it("takes the same per-user lock as the live path (a held lock blocks it)", async () => {
    const user = await insertUser(db);
    await liveHistory(user);
    let released = false;
    const holder = db.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pr:${user}`}))`;
      await new Promise((r) => setTimeout(r, 500));
      released = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    await rebuildRecords(db.prisma, silent, { userId: user });
    expect(released).toBe(true);
    await holder;
  });
});
