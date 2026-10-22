import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — one-off routines (real Postgres)", () => {
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
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const markOneOff = (id: string) => x(`UPDATE "routine" SET one_off_until = created_at + interval '336 hours' WHERE id = $1::uuid`, id);

  /** A live workout pointed at `routineId` by raw SQL (Task 6 starts through the route). */
  async function liveFrom(u: string, ex: string, routineId: string | null) {
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] });
    if (routineId) await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, workoutId, routineId);
    return workoutId;
  }

  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);

  describe("09.3 AC5 — create as a one-off", () => {
    it("oneOff: true stores created_at + 336 hours on the database clock; without it the column is NULL", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const one = await routines().create(u, routineFixture([ex], { name: "One", oneOff: true }));
      const plain = await routines().create(u, routineFixture([ex], { name: "Plain" }));
      const [row] = await q<{ gap: string; until: Date }>(
        `SELECT (one_off_until - created_at)::text AS gap, one_off_until AS until FROM "routine" WHERE id = $1::uuid`, one.id);
      expect(row!.gap).toBe("14 days");
      expect(one.oneOffUntil?.toISOString()).toBe(row!.until.toISOString());
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine" WHERE id = $1::uuid AND one_off_until IS NULL`, plain.id))[0]!.n).toBe(1);
      expect(plain.oneOffUntil).toBeNull();
    });
  });

  describe("09.3 AC6 — a PUT never changes the mark", () => {
    it("replacing a one-off or an ordinary routine keeps one_off_until byte-identical", async () => {
      const u = await insertUser(db);
      const [a, b] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
      const one = await routines().create(u, routineFixture([a], { name: "One", oneOff: true }));
      const plain = await routines().create(u, routineFixture([a], { name: "Plain" }));
      const raw = async (id: string) =>
        (await q<{ v: string | null }>(`SELECT one_off_until::text AS v FROM "routine" WHERE id = $1::uuid`, id))[0]!.v;
      const [oneBefore, plainBefore] = [await raw(one.id), await raw(plain.id)];
      const replacedOne = await routines().replace(u, one.id, routineFixture([b, a], { name: "One renamed" }));
      const replacedPlain = await routines().replace(u, plain.id, routineFixture([b], { name: "Plain renamed" }));
      expect(await raw(one.id)).toBe(oneBefore);
      expect(await raw(plain.id)).toBe(plainBefore);
      expect(plainBefore).toBeNull();
      expect(replacedOne.oneOffUntil?.toISOString()).toBe(one.oneOffUntil?.toISOString());
      expect(replacedPlain.oneOffUntil).toBeNull();
    });
  });

  describe("09.3 AC3 — list order", () => {
    it("one-offs first, newest created first, then ordinary routines by lower(name), id", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const shift = (id: string, minutes: number) =>
        x(
          `UPDATE "routine" SET created_at = created_at - make_interval(mins => $2::int), one_off_until = one_off_until - make_interval(mins => $2::int) WHERE id = $1::uuid`,
          id, minutes);
      const c = await routines().create(u, routineFixture([ex], { name: "c-one", oneOff: true }));
      const a = await routines().create(u, routineFixture([ex], { name: "A-one", oneOff: true }));
      const b = await routines().create(u, routineFixture([ex], { name: "b-one", oneOff: true }));
      await shift(c.id, 3);
      await shift(a.id, 2);
      await shift(b.id, 1);
      for (const name of ["delta", "Alpha", "charlie", "Bravo"]) await routines().create(u, routineFixture([ex], { name }));
      const listed = await routines().list(u);
      expect(listed.map((r) => r.name)).toEqual(["b-one", "A-one", "c-one", "Alpha", "Bravo", "charlie", "delta"]);
      for (const r of listed) expect((await routines().getById(u, r.id)).name).toBe(r.name);
    });

    it("one-offs created at the same instant fall back to lower(name)", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const z = await routines().create(u, routineFixture([ex], { name: "zed", oneOff: true }));
      const y = await routines().create(u, routineFixture([ex], { name: "Yak", oneOff: true }));
      await x(
        `UPDATE "routine" SET created_at = '2026-10-20T10:00:00Z', one_off_until = '2026-11-03T10:00:00Z' WHERE id = ANY($1::uuid[])`,
        [z.id, y.id]);
      expect((await routines().list(u)).map((r) => r.name)).toEqual(["Yak", "zed"]);
    });
  });

  describe("09.3 AC4 — the workout flag", () => {
    it("is true only while the workout's routine exists and carries the mark", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const flag = async (workoutId: string) => {
        const byId = (await workouts().getWorkoutById(u, workoutId)).routineIsOneOff;
        const active = (await workouts().getActiveWorkout(u)).routineIsOneOff;
        expect(active).toBe(byId);
        return byId;
      };
      const clear = (workoutId: string) => x(`DELETE FROM "workout" WHERE id = $1::uuid`, workoutId);

      let w = await liveFrom(u, ex, null);
      expect(await flag(w)).toBe(false);
      await clear(w);

      const ordinary = await routines().create(u, routineFixture([ex], { name: "Ordinary" }));
      w = await liveFrom(u, ex, ordinary.id);
      expect(await flag(w)).toBe(false);
      await clear(w);

      const oneOff = await routines().create(u, routineFixture([ex], { name: "One-off" }));
      await markOneOff(oneOff.id);
      w = await liveFrom(u, ex, oneOff.id);
      expect(await flag(w)).toBe(true);

      await x(`UPDATE "routine" SET one_off_until = NULL WHERE id = $1::uuid`, oneOff.id);
      expect(await flag(w)).toBe(false);

      // Expired but held by this live workout: still a one-off.
      await x(
        `UPDATE "routine" SET created_at = now() - interval '20 days', one_off_until = now() - interval '6 days' WHERE id = $1::uuid`,
        oneOff.id,
      );
      expect(await flag(w)).toBe(true);

      await x(`DELETE FROM "routine" WHERE id = $1::uuid`, oneOff.id);
      expect(await flag(w)).toBe(false);
    });
  });
});
