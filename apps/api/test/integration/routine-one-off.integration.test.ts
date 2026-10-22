import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { NotFoundError } from "../../src/errors/app-error.js";
import { bearer, makeAccountApp } from "./account-helpers.js";
import { ageOneOff } from "./one-off-helpers.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — one-off routines (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance | undefined;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
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

  /** Every child row of a routine as one JSON text, ordered (ids included). */
  const childSnapshot = async (id: string) =>
    JSON.stringify(
      await q(
        `SELECT
           (SELECT json_agg(to_jsonb(i) ORDER BY i.position) FROM "routine_item" i WHERE i.routine_id = $1::uuid) AS items,
           (SELECT json_agg(to_jsonb(s) ORDER BY s.position) FROM "routine_section" s WHERE s.routine_id = $1::uuid) AS sections,
           (SELECT json_agg(to_jsonb(p) ORDER BY p.id) FROM "routine_item_set" p
              JOIN "routine_item" i ON i.id = p.routine_item_id WHERE i.routine_id = $1::uuid) AS sets`,
        id,
      ),
    );
  const header = async (id: string) =>
    (await q<{ name: string; one_off_until: Date | null; updated_at: Date }>(
      `SELECT name, one_off_until, updated_at FROM "routine" WHERE id = $1::uuid`, id))[0];
  /** A one-off with a section and planned rows. */
  const richOneOff = (u: string, ex: string, name: string) =>
    routines().create(u, {
      ...routineFixture([ex], { name, oneOff: true, sections: [{ key: "s", name: "Main", notes: "n" }] }),
      items: [{ exerciseId: ex, sectionKey: "s", sets: [{ setType: "working", repsLow: 5, repsHigh: 5 }] }],
    });

  describe("09.3 AC8 — Keep", () => {
    it("clears the mark and bumps updated_at; children, id and name untouched; never swept afterwards", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const r = await richOneOff(u, ex, "Keep me");
      const children = await childSnapshot(r.id);
      const before = await header(r.id);
      expect(await routines().keep(u, r.id)).toEqual({ changed: true });
      const after = await header(r.id);
      expect(after!.one_off_until).toBeNull();
      expect(after!.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime());
      expect(after!.name).toBe("Keep me");
      expect(await childSnapshot(r.id)).toBe(children);
      expect((await routines().getById(u, r.id)).oneOffUntil).toBeNull();
      await x(`UPDATE "routine" SET created_at = created_at - interval '30 days' WHERE id = $1::uuid`, r.id);
      expect((await routines().list(u)).map((x) => x.id)).toEqual([r.id]);
    });
  });

  describe("09.3 AC9 — Keep is idempotent and total", () => {
    it("a repeat and an ordinary routine are no-ops; an expired unswept one-off is rescued", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const r = await richOneOff(u, ex, "Twice");
      await routines().keep(u, r.id);
      const once = await header(r.id);
      expect(await routines().keep(u, r.id)).toEqual({ changed: false });
      expect((await header(r.id))!.updated_at.getTime()).toBe(once!.updated_at.getTime());

      const plain = await routines().create(u, routineFixture([ex], { name: "Plain" }));
      const plainBefore = await header(plain.id);
      expect(await routines().keep(u, plain.id)).toEqual({ changed: false });
      expect((await header(plain.id))!.updated_at.getTime()).toBe(plainBefore!.updated_at.getTime());

      const stale = await richOneOff(u, ex, "Stale");
      await ageOneOff(db, stale.id, 20);
      expect(await routines().keep(u, stale.id)).toEqual({ changed: true });
      expect((await routines().list(u)).map((x) => x.name)).toContain("Stale");
    });

    it("a foreign, missing, malformed or swept id is NotFoundError, and the owner's mark is untouched", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: a });
      const r = await richOneOff(a, ex, "A's");
      const mark = (await header(r.id))!.one_off_until!.getTime();
      await expect(routines().keep(b, r.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await header(r.id))!.one_off_until!.getTime()).toBe(mark);
      await expect(routines().keep(a, "018fcb3e-3b8a-7d6e-9c1a-00000000ffff")).rejects.toBeInstanceOf(NotFoundError);
      await expect(routines().keep(a, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
      await ageOneOff(db, r.id, 20);
      await routines().list(a);
      await expect(routines().keep(a, r.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("09.3 Review Focus 5 — 51 routines after a rescue", () => {
    it("49 + an expired held one-off + a create; Keep is 204; the list shows 51; the next create is 409 routine-limit", async () => {
      app = await makeAccountApp(db);
      const token = bearer("rescue-a");
      await app.inject({ method: "GET", url: "/v1/me", headers: token });
      const u = (await q<{ id: string }>(`SELECT id FROM "user" WHERE auth_sub = 'auth0|rescue-a'`))[0]!.id;
      const ex = await insertExercise(db, { ownerUserId: u });
      for (let i = 0; i < ROUTINES_PER_USER_MAX - 1; i += 1) await routines().create(u, routineFixture([ex], { name: `R${i}` }));
      const held = await richOneOff(u, ex, "held");
      await ageOneOff(db, held.id, 20);
      await liveFrom(u, ex, held.id);
      const post = (name: string) =>
        app!.inject({ method: "POST", url: "/v1/routines", headers: token, payload: { name, items: [{ exerciseId: ex }] } });
      expect((await post("the 51st")).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/v1/routines/${held.id}/keep`, headers: token })).statusCode).toBe(204);
      const list = await app.inject({ method: "GET", url: "/v1/routines", headers: token });
      expect(list.json().routines).toHaveLength(ROUTINES_PER_USER_MAX + 1);
      const refused = await post("the 52nd");
      expect(refused.statusCode).toBe(409);
      expect(refused.json().type).toContain("routine-limit");
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
