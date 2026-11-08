import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createScopedDb } from "../../src/db/scoped.js";
import { rawSqlState } from "../../src/repositories/pg-errors.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture } from "./routine-helpers.js";
import { TRUNCATE_ACCOUNTS } from "./account-helpers.js";
import { toWorkoutDetailDto } from "../../src/routes/mappers.js";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe.skipIf(!shouldRunIntegration())("Spec 11 — export snapshot repository (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ACCOUNTS);
  });

  async function nWorkouts(user: string, n: number) {
    const ex = await insertExercise(db, { ownerUserId: user });
    for (let i = 0; i < n; i++) {
      await logWorkout(db, user, { startedAt: daysAgo(n - i + 1), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] }] });
    }
  }

  it("empty account → the user and empty collections (Review Focus 1)", async () => {
    const u = await insertUser(db);
    const s = await createAccountExportRepository(db.prisma).snapshot(u);
    expect(s.user.id).toBe(u);
    expect([s.exercises, s.routines, s.workouts]).toEqual([[], [], []]);
    expect(Math.abs(s.exportedAt.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("AC3 — collections, membership and order; an exercise with no sets has sets: [] (Review Focus 2)", async () => {
    const u = await insertUser(db);
    const global = await insertExercise(db);
    const active = await insertExercise(db, { ownerUserId: u, name: "Active" });
    const retired = await insertExercise(db, { ownerUserId: u, name: "Retired" });
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, retired);
    const fork = await insertExercise(db, { ownerUserId: u, forkedFrom: global, name: "Fork" });
    await createRoutineRepository(db.prisma).create(u, routineFixture([active], { name: "b routine" }));
    await createRoutineRepository(db.prisma).create(u, routineFixture([fork], { name: "A routine" }));
    const newer = await logWorkout(db, u, { startedAt: daysAgo(1), exercises: [{ exerciseId: active, sets: [{ reps: 3, weight: 50 }, { reps: 4, weight: 50 }] }, { exerciseId: fork, sets: [] }] });
    const older = await logWorkout(db, u, { startedAt: daysAgo(5), exercises: [{ exerciseId: global, sets: [{ reps: 1, weight: 1 }] }] });
    const live = await logWorkout(db, u, { startedAt: new Date(Date.now() - 60_000), finish: "none", exercises: [{ exerciseId: active, sets: [{ reps: 2, weight: 2 }] }] });

    const s = await createAccountExportRepository(db.prisma).snapshot(u);
    expect(s.exercises.map((e) => e.id)).toEqual([active, retired, fork]);
    expect(s.exercises.find((e) => e.id === retired)!.isActive).toBe(false);
    expect(s.routines.map((r) => r.name)).toEqual(["A routine", "b routine"]);
    expect(s.workouts.map((w) => w.id)).toEqual([older.workoutId, newer.workoutId, live.workoutId]);
    const n = s.workouts[1]!;
    expect(n.exercises.map((e) => e.exerciseId)).toEqual([active, fork]);
    expect(n.exercises[0]!.sets.map((x) => x.setNumber)).toEqual([1, 2]);
    expect(n.exercises[1]!.sets).toEqual([]);
    expect(s.workouts[2]!.endedAt).toBeNull();
  });

  it("AC5 — another user's rows never appear", async () => {
    const a = await insertUser(db);
    const b = await insertUser(db);
    for (const u of [a, b]) {
      const ex = await insertExercise(db, { ownerUserId: u, name: "Same name" });
      await createRoutineRepository(db.prisma).create(u, routineFixture([ex], { name: "Same routine" }));
      await logWorkout(db, u, { startedAt: daysAgo(2), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    }
    const s = await createAccountExportRepository(db.prisma).snapshot(a);
    expect(s.exercises.every((e) => e.ownerUserId === a)).toBe(true);
    expect(s.routines.every((r) => r.userId === a)).toBe(true);
    expect(s.workouts.every((w) => w.userId === a)).toBe(true);
    expect(s.workouts.flatMap((w) => w.exercises).every((e) => s.workouts.some((w) => w.id === e.workoutId))).toBe(true);
  });

  // Spec 21.1 AC17: the same probe passes unchanged through the scoped handle, which sends READ ONLY then set_config.
  for (const via of ["the owner client", "the scoped handle"] as const) {
  it(`AC7 — REPEATABLE READ, read-only, and writes committed mid-export are invisible (${via}; Spec 21.1 AC17)`, async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const routine = (await createRoutineRepository(db.prisma).create(u, routineFixture([ex], { name: "Before" }))).routine;
    const kept = await logWorkout(db, u, { startedAt: daysAgo(3), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    const doomed = await logWorkout(db, u, { startedAt: daysAgo(2), exercises: [{ exerciseId: ex, sets: [{ reps: 6, weight: 6 }] }] });
    const [weRow] = await db.prisma.$queryRawUnsafe<{ we_id: string }[]>(
      `SELECT id::text AS we_id FROM "workout_exercise" WHERE workout_id = $1::uuid`, kept.workoutId);
    const we_id = weRow!.we_id;
    let probe: { iso: string; ro: string; who: string | null } | undefined;
    let writeState: string | null = null;

    const repo = createAccountExportRepository(via === "the scoped handle" ? createScopedDb(db.prisma) : db.prisma, {
      afterExercises: async (tx) => {
        [probe] = await tx.$queryRaw<{ iso: string; ro: string; who: string | null }[]>`
          SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro,
                 NULLIF(current_setting('app.user_id', true), '') AS who`;
        // A write inside fails 25006; the savepoint keeps the export's transaction usable.
        await tx.$executeRaw`SAVEPOINT probe`;
        try {
          await tx.$executeRaw`UPDATE "user" SET timezone = timezone WHERE id = ${u}::uuid`;
        } catch (err) {
          writeState = rawSqlState(err);
        }
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT probe`;
        // Committed on other connections while the export's snapshot is open.
        await db.prisma.$executeRawUnsafe(
          `INSERT INTO "set_entry" ("id","workout_exercise_id","set_number","set_type","reps","weight","weight_unit","is_complete")
           VALUES ($1::uuid,$2::uuid,2,'working',9,9,'kg',true)`, uuidv7(), we_id);
        await db.prisma.$executeRawUnsafe(`DELETE FROM "workout" WHERE id = $1::uuid`, doomed.workoutId);
        await createRoutineRepository(db.prisma).replace(u, routine.id, routineFixture([ex], { name: "After" }));
      },
    });
    const s = await repo.snapshot(u);
    expect(probe).toEqual({ iso: "repeatable read", ro: "on", who: via === "the scoped handle" ? u : null });
    expect(writeState).toBe("25006");
    expect(s.workouts.map((w) => w.id)).toEqual([kept.workoutId, doomed.workoutId]);
    expect(s.workouts[0]!.exercises[0]!.sets).toHaveLength(1);
    expect(s.routines.map((r) => r.name)).toEqual(["Before"]);
    const weIds = new Set(s.workouts.flatMap((w) => w.exercises.map((e) => e.id)));
    expect(s.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets)).every((x) => weIds.has(x.workoutExerciseId))).toBe(true);
  });
  }

  it("AC8 / 09.5 AC11 — a fixed statement count: 5 workouts and 60 workouts (timed sections with round times) issue the same number, ≤ 8", async () => {
    const count = async (user: string) => {
      const seen = await startCapture(db);
      await createAccountExportRepository(db.prisma).snapshot(user);
      await settleCapture(db, seen);
      return seen.filter((q) => !/^\s*(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION ISOLATION)/i.test(q)).length;
    };
    const small = await insertUser(db);
    const big = await insertUser(db);
    await nWorkouts(small, 5);
    await nWorkouts(big, 60);
    for (const user of [small, big]) {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout_section" (id, workout_id, position, name, timer_format, timer_cap_s)
         SELECT gen_random_uuid(), id, 0, 'S', 'amrap', 720 FROM "workout" WHERE user_id = $1::uuid`, user);
      // Spec 09.5 AC11 — round rows ride the same aggregate: no extra statement per section.
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds)
         SELECT s.id, r, r * 100 FROM "workout_section" s JOIN "workout" w ON w.id = s.workout_id, generate_series(1, 3) r
         WHERE w.user_id = $1::uuid`, user);
    }
    const nSmall = await count(small);
    const nBig = await count(big);
    expect(nBig).toBe(nSmall);
    expect(nSmall).toBeGreaterThanOrEqual(7); // not vacuous: the listener really saw the statements
    expect(nSmall).toBeLessThanOrEqual(8);
  });

  // Spec 07.4 AC30: the export's workout statement is hand-written (Spec 11), so the new column needs its own pin.
  it("07.4 AC30 — each workout carries plannedDurationSeconds as stored: the live plan, null once finished", async () => {
    const u = await insertUser(db);
    const finished = (await logWorkout(db, u, { startedAt: daysAgo(3), exercises: [] })).workoutId;
    const live = (await logWorkout(db, u, { startedAt: daysAgo(0.1), finish: "none", exercises: [] })).workoutId;
    await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET planned_duration_s = 2700 WHERE id = $1::uuid`, live);
    const s = await createAccountExportRepository(db.prisma).snapshot(u);
    const dto = (id: string) => toWorkoutDetailDto(s.workouts.find((w) => w.id === id)!);
    expect(dto(live).plannedDurationSeconds).toBe(2700);
    expect(dto(finished).plannedDurationSeconds).toBeNull();
  });
});
