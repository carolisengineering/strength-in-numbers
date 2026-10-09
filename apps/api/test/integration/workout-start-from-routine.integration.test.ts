import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { ExerciseRetiredError, NotFoundError, WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, recordsOf, type RecordRow } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

/**
 * Spec 09 §6.5 — start from a routine inside the idempotent start transaction:
 * the copy (AC16), atomic failures (AC17), replay (AC18), the one-active rule
 * (AC19), self-containment (AC15/AC21) and the PR engine's indifference (AC22).
 */
describe.skipIf(!shouldRunIntegration())("Spec 09 — POST /v1/workouts with routineId (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });

  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const routines = () => createRoutineRepository(db.prisma);
  const start = (u: string, routineId?: string, key = uuidv7()) =>
    workouts().createWorkout(
      u,
      { clientGeneratedId: key, startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null, routineId },
      "UTC",
    );
  const count = async (table: string, where = "", ...args: unknown[]): Promise<number> => {
    const [row] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" ${where}`, ...args);
    return Number(row!.n);
  };
  const endedSoon = () => new Date(Date.now() + 60_000).toISOString();

  it("AC16 — start copies every item in position order with snapshots, targets and groups; no set_entry; routine columns set", async () => {
    const u = await insertUser(db);
    const bench = await insertExercise(db, { name: "Bench", modality: "weight_reps" });
    const row = await insertExercise(db, { name: "Row" });
    const custom = await insertExercise(db, { name: "My Dips", ownerUserId: u, modality: "bodyweight_reps" });
    const r = await routines().create(
      u,
      routineFixture([], {
        name: "Push A",
        items: [
          { exerciseId: bench, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8.5, restSeconds: 120, supersetGroup: 7 },
          { exerciseId: row, targetSets: 4, supersetGroup: 7 },
          { exerciseId: bench, targetSets: 2 },
          { exerciseId: custom, restSeconds: 0 },
        ],
      }),
    );
    const { workout, created } = await start(u, r.id);
    expect(created).toBe(true);
    expect(workout.routineName).toBe("Push A");
    const detail = await workouts().getWorkoutById(u, workout.id);
    expect(
      detail.exercises.map((e) => [
        e.position, e.exerciseId, e.exerciseNameSnapshot, e.modalitySnapshot, e.targetSets, e.targetRepsLow,
        e.targetRepsHigh, e.targetRpeTenths, e.restSeconds, e.supersetGroup, e.notes, e.sets.length,
      ]),
    ).toEqual([
      [0, bench, "Bench", "weight_reps", 4, 6, 8, 85, 120, 1, null, 0],
      [1, row, "Row", "weight_reps", 4, null, null, null, null, 1, null, 0],
      [2, bench, "Bench", "weight_reps", 2, null, null, null, null, null, null, 0],
      [3, custom, "My Dips", "bodyweight_reps", null, null, null, null, 0, null, null, 0],
    ]);
    const [w] = await db.prisma.$queryRawUnsafe<{ routine_id: string }[]>(`SELECT routine_id FROM "workout" WHERE id = $1::uuid`, workout.id);
    expect(w!.routine_id).toBe(r.id);
    expect(await count("set_entry")).toBe(0);
  });

  it("AC17 — unknown or foreign routine is NotFoundError, a retired item is ExerciseRetiredError on routineId; no workout row survives", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    const theirs = await routines().create(v, routineFixture([ex]));
    const mine = await routines().create(u, routineFixture([ex, ex]));
    await expect(start(u, uuidv7())).rejects.toBeInstanceOf(NotFoundError);
    expect(await count("workout")).toBe(0);
    await expect(start(u, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await count("workout")).toBe(0);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, ex);
    const err = start(u, mine.id);
    await expect(err).rejects.toBeInstanceOf(ExerciseRetiredError);
    await expect(err).rejects.toMatchObject({
      fieldErrors: [{ path: "routineId", message: "item at position 0 refers to a retired exercise" }],
    });
    expect(await count("workout")).toBe(0);
    // The user is not left with a ghost active workout after the rollback.
    await expect(start(u)).resolves.toMatchObject({ created: true });
  });

  it("AC18 — a replay with the same key returns the stored workout whatever routineId it carries, copies nothing twice, never re-reads the routine", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routines().create(u, routineFixture([ex, ex]));
    const other = await routines().create(u, routineFixture([ex], { name: "Other" }));
    const key = uuidv7();
    const first = await start(u, r.id, key);
    expect(first.created).toBe(true);
    for (const routineId of [r.id, other.id, undefined]) {
      const replay = await start(u, routineId, key);
      expect(replay.created, String(routineId)).toBe(false);
      expect(replay.workout.id).toBe(first.workout.id);
    }
    await routines().delete(u, r.id);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, ex);
    const late = await start(u, r.id, key);
    expect(late.created).toBe(false);
    expect(late.workout.routineName).toBe("Push A");
    expect((await workouts().getWorkoutById(u, first.workout.id)).exercises).toHaveLength(2);
  });

  it("AC19 — with an active workout a routine start is WorkoutInProgressExistsError and copies nothing; two concurrent starts give one created, one 409", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routines().create(u, routineFixture([ex]));
    await start(u);
    await expect(start(u, r.id)).rejects.toBeInstanceOf(WorkoutInProgressExistsError);
    expect(await count("workout_exercise")).toBe(0);

    const v = await insertUser(db);
    const rv = await routines().create(v, routineFixture([ex]));
    const results = await Promise.allSettled([start(v, rv.id), start(v)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected" && x.reason instanceof WorkoutInProgressExistsError)).toHaveLength(1);
    expect(await count("workout", `WHERE user_id = $1::uuid AND ended_at IS NULL`, v)).toBe(1);
  });

  it("AC19 / §6.8 — a routine DELETE racing a start: the start wins (snapshot kept, routine_id nulled) or is 404; never a torn copy", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routines().create(u, routineFixture([ex, ex, ex]));
    const [s, d] = await Promise.allSettled([start(u, r.id), routines().delete(u, r.id)]);
    expect(d.status).toBe("fulfilled");
    if (s.status === "fulfilled") {
      const detail = await workouts().getWorkoutById(u, s.value.workout.id);
      expect(detail.exercises).toHaveLength(3);
      expect(detail.routineName).toBe("Push A");
      const [w] = await db.prisma.$queryRawUnsafe<{ routine_id: null }[]>(`SELECT routine_id FROM "workout" WHERE id = $1::uuid`, s.value.workout.id);
      expect(w!.routine_id).toBeNull();
    } else {
      expect(s.reason).toBeInstanceOf(NotFoundError);
      expect(await count("workout")).toBe(0);
    }
  });

  it("AC15 / AC21 — editing, replacing or deleting the routine after a start changes nothing in the workout; routineName survives delete", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const ex2 = await insertExercise(db);
    const r = await routines().create(u, routineFixture([ex, ex]));
    const { workout } = await start(u, r.id);
    const before = await workouts().getWorkoutById(u, workout.id);
    await routines().replace(u, r.id, routineFixture([ex2], { name: "Renamed" }));
    expect(await workouts().getWorkoutById(u, workout.id)).toEqual(before);
    await routines().delete(u, r.id);
    const after = await workouts().getWorkoutById(u, workout.id);
    expect(after).toEqual(before);
    expect(after.routineName).toBe("Push A");
    expect(after.exercises.map((e) => e.position)).toEqual([0, 1]);
  });

  it("AC22 — the PR engine is indifferent: a routine-started workout with a repeated exercise yields the same records as its manual twin, live and via records:rebuild", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const bench = await insertExercise(db, { name: "Bench" });
    const r = await routines().create(u, routineFixture([bench, bench]));
    const { workout } = await start(u, r.id);
    const detail = await workouts().getWorkoutById(u, workout.id);
    for (const [i, we] of detail.exercises.entries()) {
      await workouts().createSet(u, we.id, { setType: "working", reps: 5, weight: 100 + i * 10, weightUnit: "kg", isComplete: true });
    }
    await workouts().updateWorkout(u, workout.id, { endedAt: endedSoon() });
    const live = await recordsOf(db, u);
    expect(live.length).toBeGreaterThan(0);

    const { workout: manual } = await start(v);
    for (let i = 0; i < 2; i += 1) {
      const we = await workouts().addWorkoutExercise(v, manual.id, { exerciseId: bench });
      await workouts().createSet(v, we.id, { setType: "working", reps: 5, weight: 100 + i * 10, weightUnit: "kg", isComplete: true });
    }
    await workouts().updateWorkout(v, manual.id, { endedAt: endedSoon() });
    const twin = await recordsOf(db, v);
    const shape = (rows: RecordRow[]) => rows.map(({ record_type, value, previous_value }) => ({ record_type, value, previous_value }));
    expect(shape(live)).toEqual(shape(twin));

    await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
    expect(shape(await recordsOf(db, u))).toEqual(shape(live));
  });
});
