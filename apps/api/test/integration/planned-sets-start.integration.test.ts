import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";

const RAMP = [
  { setType: "warmup" as const, repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" as const },
  { setType: "working" as const, repsLow: 6, repsHigh: 6, weight: 225, weightUnit: "lb" as const },
];
const LIGHT = [{ setType: "working" as const, repsLow: 15, repsHigh: 15, weight: 20, weightUnit: "kg" as const }];

describe.skipIf(!shouldRunIntegration())("Spec 09.1 — start copy and workout reads (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertDerivedColumnsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const start = (u: string, routineId: string, key = uuidv7()) =>
    workouts().createWorkout(u, { clientGeneratedId: key, startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId }, "UTC");
  const plannedCount = async () =>
    Number((await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "workout_planned_set"`))[0]!.n);

  /** Items: ramp on A, nothing on B, ramp on A again with LIGHT (Review Focus 1), legacy 2 sets on B. */
  async function fixture(u: string) {
    const a = await insertExercise(db, { ownerUserId: u });
    const b = await insertExercise(db, { ownerUserId: u });
    const routine = await routines().create(u, {
      name: "Day 1", notes: null,
      items: [
        { exerciseId: a, sets: RAMP },
        { exerciseId: b, sets: [] },
        { exerciseId: a, sets: LIGHT },
        { exerciseId: b, targetSets: 2, targetRepsLow: 8, targetRepsHigh: 8 },
      ],
    });
    return { a, b, routine };
  }

  it("AC12 — rows land on the exercise created from their item (by position), verbatim, units included; no set_entry", async () => {
    const u = await insertUser(db);
    const { routine } = await fixture(u);
    const { workout, plannedSetCount } = await start(u, routine.id);
    expect(plannedSetCount).toBe(5);
    const detail = await workouts().getWorkoutById(u, workout.id);
    expect(detail.exercises.map((e) => e.plannedSets)).toEqual([
      RAMP,
      [],
      LIGHT,
      [{ setType: "working", repsLow: 8, repsHigh: 8, weight: null, weightUnit: null }, { setType: "working", repsLow: 8, repsHigh: 8, weight: null, weightUnit: null }],
    ]);
    expect(detail.exercises.flatMap((e) => e.sets)).toEqual([]);
  });

  it("AC13 — replacing and deleting the routine afterwards changes nothing in the workout", async () => {
    const u = await insertUser(db);
    const { a, routine } = await fixture(u);
    const { workout } = await start(u, routine.id);
    const before = (await workouts().getWorkoutById(u, workout.id)).exercises.map((e) => e.plannedSets);
    await routines().replace(u, routine.id, { name: "Day 1", notes: null, items: [{ exerciseId: a, sets: LIGHT }] });
    expect((await workouts().getWorkoutById(u, workout.id)).exercises.map((e) => e.plannedSets)).toEqual(before);
    await routines().delete(u, routine.id);
    expect((await workouts().getWorkoutById(u, workout.id)).exercises.map((e) => e.plannedSets)).toEqual(before);
  });

  it("AC14 — a replay after the routine was replaced and deleted copies nothing again", async () => {
    const u = await insertUser(db);
    const { a, routine } = await fixture(u);
    const key = uuidv7();
    const first = await start(u, routine.id, key);
    await routines().replace(u, routine.id, { name: "Day 1", notes: null, items: [{ exerciseId: a, sets: LIGHT }] });
    await routines().delete(u, routine.id);
    const replay = await start(u, routine.id, key);
    expect(replay).toMatchObject({ created: false, plannedSetCount: 0 });
    expect(replay.workout.id).toBe(first.workout.id);
    expect(await plannedCount()).toBe(5);
  });

  it("AC14 — a failed start (retired exercise) leaves no workout and no planned rows", async () => {
    const u = await insertUser(db);
    const { a, routine } = await fixture(u);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, a);
    await expect(start(u, routine.id)).rejects.toMatchObject({ status: 409 });
    const n = (await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM "workout") + (SELECT count(*) FROM "workout_planned_set") AS n`))[0]!.n;
    expect(Number(n)).toBe(0);
  });

  it("AC15 — active / add / patch shapes; reorder and regroup keep rows attached (Review Focus 4); pre-0010 exercise reads []", async () => {
    const u = await insertUser(db);
    const { a, routine } = await fixture(u);
    const { workout } = await start(u, routine.id);
    const active = await workouts().getActiveWorkout(u);
    expect(active.exercises[0]!.plannedSets).toEqual(RAMP);
    const added = await workouts().addWorkoutExercise(u, workout.id, { exerciseId: a });
    expect(added.plannedSets).toEqual([]);
    const first = active.exercises[0]!;
    const moved = await workouts().updateWorkoutExercise(u, first.id, { position: 3 });
    expect(moved.plannedSets).toEqual(RAMP);
    const regrouped = await workouts().updateWorkoutExercise(u, first.id, { supersetGroup: 7 });
    expect(regrouped.plannedSets).toEqual(RAMP);
    // A workout written before 0010 (raw insert, no planned rows):
    const old = await logWorkout(db, u, { startedAt: new Date(Date.now() - 86_400_000 * 3), exercises: [{ exerciseId: a, sets: [] }] });
    expect((await workouts().getWorkoutById(u, old.workoutId)).exercises[0]!.plannedSets).toEqual([]);
  });

  it("AC13 — deleting a workout exercise or the workout removes its rows", async () => {
    const u = await insertUser(db);
    const { routine } = await fixture(u);
    const { workout } = await start(u, routine.id);
    const first = (await workouts().getWorkoutById(u, workout.id)).exercises[0]!;
    await workouts().deleteWorkoutExercise(u, first.id);
    expect(await plannedCount()).toBe(3);
    await workouts().deleteWorkout(u, workout.id);
    expect(await plannedCount()).toBe(0);
  });

  it("AC16 — a workout whose plan was never logged finishes normally; PRs come from set_entry only", async () => {
    const u = await insertUser(db);
    const { routine } = await fixture(u);
    const { workout } = await start(u, routine.id);
    const finished = await workouts().updateWorkout(u, workout.id, { endedAt: new Date().toISOString() });
    expect(finished.workout.endedAt).not.toBeNull();
    const n = (await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "personal_record" WHERE user_id = $1::uuid`, u))[0]!.n;
    expect(n).toBe(0);
  });
});
