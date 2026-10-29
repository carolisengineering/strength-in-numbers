import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { RoutineLimitError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { bearer, makeAccountApp } from "./account-helpers.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { ageOneOff, captureStatements } from "./one-off-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

/** Spec 09.2 AC30's bound, reused (09.3 AC30). */
const LIST_BOUND_MS = 1_000;

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — the lazy expiry sweep (real Postgres)", () => {
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
    await assertSectionsConsistent(db);
    await assertDerivedColumnsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const exists = async (id: string) => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine" WHERE id = $1::uuid`, id))[0]!.n === 1;
  const children = async (id: string) =>
    (
      await q<{ n: number }>(
        `SELECT ((SELECT count(*) FROM "routine_item" WHERE routine_id = $1::uuid)
              + (SELECT count(*) FROM "routine_section" WHERE routine_id = $1::uuid)
              + (SELECT count(*) FROM "routine_item_set" s JOIN "routine_item" i ON i.id = s.routine_item_id WHERE i.routine_id = $1::uuid))::int AS n`,
        id,
      )
    )[0]!.n;

  /** A one-off with a section, two items and planned rows on the first. */
  async function oneOff(u: string, ex: string, name: string) {
    return routines().create(u, {
      ...routineFixture([ex, ex], { name, oneOff: true, sections: [{ key: "s", name: "Main" }], sectionKeys: ["s", "s"] }),
      items: [
        { exerciseId: ex, sectionKey: "s", sets: [{ setType: "working", repsLow: 5, repsHigh: 5 }] },
        { exerciseId: ex, sectionKey: "s", targetSets: 3 },
      ],
    }).then((r) => r.routine);
  }
  /** A live workout pointed at `routineId` by raw SQL. */
  async function liveFrom(u: string, ex: string, routineId: string) {
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] });
    await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, workoutId, routineId);
    return workoutId;
  }

  describe("09.3 AC19 — what the sweep removes", () => {
    it("only the caller's expired one-offs with no live workout, children included", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const exA = await insertExercise(db, { ownerUserId: a });
      const exB = await insertExercise(db, { ownerUserId: b });
      const expired = await oneOff(a, exA, "expired");
      const held = await oneOff(a, exA, "held");
      const fresh = await oneOff(a, exA, "fresh");
      const old = (await routines().create(a, routineFixture([exA], { name: "old ordinary" }))).routine;
      const repaired = await oneOff(a, exA, "finished only");
      const others = await oneOff(b, exB, "B's");
      for (const r of [expired, held, repaired, others]) await ageOneOff(db, r.id, 20);
      await x(`UPDATE "routine" SET created_at = now() - interval '60 days' WHERE id = $1::uuid`, old.id);
      await liveFrom(a, exA, held.id);
      const done = await logWorkout(db, a, { startedAt: new Date(Date.now() - 2 * 86_400_000), exercises: [{ exerciseId: exA, sets: [] }] });
      await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, done.workoutId, repaired.id);

      const listed = (await routines().list(a)).routines;
      expect(listed.map((r) => r.name).sort()).toEqual(["fresh", "held", "old ordinary"]);
      expect(await exists(expired.id)).toBe(false);
      expect(await exists(repaired.id)).toBe(false);
      expect(await children(expired.id)).toBe(0);
      expect(await children(repaired.id)).toBe(0);
      for (const r of [held, fresh, old, others]) expect(await exists(r.id)).toBe(true);
      expect(await children(others.id)).toBeGreaterThan(0);
    });
  });

  describe("09.3 AC20 — a held one-off survives", () => {
    it("survives list and create while held; the next list after a discard removes it", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const held = await oneOff(u, ex, "held");
      await ageOneOff(db, held.id, 20);
      const w = await liveFrom(u, ex, held.id);
      await routines().list(u);
      await routines().create(u, routineFixture([ex], { name: "another" }));
      expect(await exists(held.id)).toBe(true);
      await workouts().deleteWorkout(u, w);
      expect(((await routines().list(u)).routines).map((r) => r.name)).toEqual(["another"]);
      expect(await exists(held.id)).toBe(false);
    });
  });

  describe("09.3 AC21 — where the sweep runs", () => {
    it("with nothing expired, a list is two statements (the probe and the list): no transaction, no DELETE", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      await oneOff(u, ex, "fresh");
      await routines().create(u, routineFixture([ex], { name: "ordinary" }));
      const seen = captureStatements(db);
      seen.length = 0;
      await routines().list(u);
      expect(seen).toHaveLength(2);
      expect(seen.join("\n")).not.toMatch(/BEGIN|DELETE/i);
    });

    it("an expired one-off a live workout holds is not sweepable: still two statements, no lock, no DELETE (/code-review)", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const held = await oneOff(u, ex, "held");
      await ageOneOff(db, held.id, 20);
      await liveFrom(u, ex, held.id);
      const seen = captureStatements(db);
      seen.length = 0;
      expect(((await routines().list(u)).routines).map((r) => r.id)).toEqual([held.id]);
      expect(seen).toHaveLength(2);
      expect(seen.join("\n")).not.toMatch(/BEGIN|DELETE|SKIP LOCKED/i);
    });

    it("get-one, PUT, start-from-routine and DELETE never sweep; a PUT keeps the past expiry (Review Focus 2)", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const stale = await oneOff(u, ex, "stale");
      const other = await oneOff(u, ex, "other");
      await ageOneOff(db, stale.id, 20);
      await ageOneOff(db, other.id, 20);
      const before = stale.oneOffUntil!.getTime() - 20 * 86_400_000;

      expect((await routines().getById(u, stale.id)).id).toBe(stale.id);
      const put = await routines().replace(u, stale.id, routineFixture([ex], { name: "stale edited" }));
      expect(put.oneOffUntil!.getTime()).toBe(before);
      expect(await exists(other.id)).toBe(true);

      const started = await workouts().createWorkout(
        u,
        { clientGeneratedId: crypto.randomUUID(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null, routineId: stale.id },
        "UTC",
      );
      expect(started.workout.id).toBeTruthy();
      expect(await exists(other.id)).toBe(true);
      await routines().delete(u, other.id);
      expect(await exists(stale.id)).toBe(true);
      // The next list read leaves the held one and would sweep any other expired row.
      expect(((await routines().list(u)).routines).map((r) => r.name)).toEqual(["stale edited"]);
    });
  });

  describe("Minor 37 — an unheld edited one-off is swept by the next list", () => {
    it("expire a one-off, PUT it, list: it is gone", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const stale = await oneOff(u, ex, "stale");
      await ageOneOff(db, stale.id, 20);
      await routines().replace(u, stale.id, routineFixture([ex], { name: "stale edited" }));
      expect(await exists(stale.id)).toBe(true);
      const listed = await routines().list(u);
      expect([listed.swept, listed.routines]).toEqual([1, []]);
      expect(await exists(stale.id)).toBe(false);
    });
  });

  describe("Minor 38 — Keep, finish and the export never sweep (09.3 AC21)", () => {
    /** `before` runs ahead of the expiry: any create in it would sweep the expired one-off (AC21: create sweeps). */
    async function setupApp(token: string, before?: (u: string, ex: string) => Promise<unknown>) {
      app = await makeAccountApp(db);
      await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
      const u = (await q<{ id: string }>(`SELECT id FROM "user" WHERE auth_sub = $1`, `auth0|${token}`))[0]!.id;
      const ex = await insertExercise(db, { ownerUserId: u });
      const stale = await oneOff(u, ex, "stale");
      const extra = await before?.(u, ex);
      await ageOneOff(db, stale.id, 20);
      return { u, ex, stale, extra };
    }

    it("Keep on another routine leaves an expired, unheld one-off", async () => {
      const { stale, extra } = await setupApp("no-sweep-keep", (u, ex) => oneOff(u, ex, "other"));
      const other = extra as { id: string };
      const res = await app!.inject({ method: "POST", url: `/v1/routines/${other.id}/keep`, headers: bearer("no-sweep-keep") });
      expect(res.statusCode).toBe(204);
      expect(await exists(stale.id)).toBe(true);
    });

    it("a workout finish leaves it", async () => {
      const { u, ex, stale } = await setupApp("no-sweep-finish");
      const { workoutId } = await logWorkout(db, u, {
        startedAt: new Date(Date.now() - 3_600_000),
        finish: "none",
        exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 60 }] }],
      });
      const res = await app!.inject({ method: "PATCH", url: `/v1/workouts/${workoutId}`, headers: bearer("no-sweep-finish"), payload: { endedAt: new Date().toISOString() } });
      expect(res.statusCode).toBe(200);
      expect(await exists(stale.id)).toBe(true);
    });

    it("the account export leaves it (and lists it)", async () => {
      const { stale } = await setupApp("no-sweep-export");
      const res = await app!.inject({ method: "GET", url: "/v1/account/export", headers: bearer("no-sweep-export") });
      expect(res.statusCode).toBe(200);
      expect(await exists(stale.id)).toBe(true);
      expect(res.body).toContain(stale.id);
    });
  });

  describe("09.3 AC7 — cap and names", () => {
    it("one-offs count toward the cap; an expired held one-off does not block a create; a swept one-off frees its name", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      for (let i = 0; i < 25; i += 1) await routines().create(u, routineFixture([ex], { name: `one ${i}`, oneOff: true }));
      for (let i = 0; i < 25; i += 1) await routines().create(u, routineFixture([ex], { name: `ord ${i}` }));
      await expect(routines().create(u, routineFixture([ex], { name: "51st" }))).rejects.toBeInstanceOf(RoutineLimitError);

      // 49 ordinary + 1 expired one-off held by a live workout → a create succeeds (51 rows).
      await x(`DELETE FROM "routine" WHERE user_id = $1::uuid AND one_off_until IS NOT NULL`, u);
      for (let i = 25; i < 49; i += 1) await routines().create(u, routineFixture([ex], { name: `ord ${i}` }));
      const held = await oneOff(u, ex, "held");
      await ageOneOff(db, held.id, 20);
      await liveFrom(u, ex, held.id);
      await routines().create(u, routineFixture([ex], { name: "the 51st row" }));
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine" WHERE user_id = $1::uuid`, u))[0]!.n).toBe(ROUTINES_PER_USER_MAX + 1);
    });

    it("an expired, unswept one-off named 'Leg day' does not block a create named 'leg day'", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const legDay = await oneOff(u, ex, "Leg day");
      await ageOneOff(db, legDay.id, 20);
      const created = (await routines().create(u, routineFixture([ex], { name: "leg day" }))).routine;
      expect(created.name).toBe("leg day");
      expect(await exists(legDay.id)).toBe(false);
    });
  });

  describe("09.3 AC22 — the list ETag moves when the sweep removes rows", () => {
    it("a pre-sweep If-None-Match is 200 with a new ETag; with nothing expired the current ETag is 304", async () => {
      app = await makeAccountApp(db);
      await app.inject({ method: "GET", url: "/v1/me", headers: bearer("sweep-a") });
      const u = (await q<{ id: string }>(`SELECT id FROM "user" WHERE auth_sub = 'auth0|sweep-a'`))[0]!.id;
      const ex = await insertExercise(db, { ownerUserId: u });
      const doomed = await oneOff(u, ex, "doomed");
      await oneOff(u, ex, "kept");
      const get = (inm?: string) =>
        app!.inject({ method: "GET", url: "/v1/routines", headers: { ...bearer("sweep-a"), ...(inm ? { "if-none-match": inm } : {}) } });
      const first = await get();
      const e1 = first.headers.etag as string;
      await ageOneOff(db, doomed.id, 20);
      const second = await get(e1);
      expect(second.statusCode).toBe(200);
      expect(second.headers.etag).not.toBe(e1);
      expect((second.json().routines as { name: string }[]).map((r) => r.name)).toEqual(["kept"]);
      expect((await get(second.headers.etag as string)).statusCode).toBe(304);
    });
  });

  describe("09.3 AC30 — the bounded read with one-offs mixed in", () => {
    it("50 full routines, 20 of them unexpired one-offs: the probe plus ONE list statement, within the bound", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      await x(`INSERT INTO "routine" (id, user_id, name) SELECT gen_random_uuid(), $1::uuid, 'R' || g FROM generate_series(1, 50) g`, u);
      await x(
        `INSERT INTO "routine_section" (id, routine_id, position, name, notes)
         SELECT gen_random_uuid(), r.id, p, repeat('n', 40), repeat('x', 2000) FROM "routine" r, generate_series(0, 7) p WHERE r.user_id = $1::uuid`, u);
      await x(
        `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, target_sets, target_reps_low, target_reps_high, section_id)
         SELECT gen_random_uuid(), r.id, p, $2::uuid, 20, 5, 5,
                (SELECT s.id FROM "routine_section" s WHERE s.routine_id = r.id AND s.position = LEAST(7, p / 4))
         FROM "routine" r, generate_series(0, 29) p WHERE r.user_id = $1::uuid`, u, ex);
      await x(
        `INSERT INTO "routine_item_set" (id, routine_item_id, position, set_type, reps_low, reps_high, weight, weight_unit)
         SELECT gen_random_uuid(), ri.id, s, 'working', 5, 5, 100, 'kg' FROM "routine_item" ri, generate_series(0, 19) s`);
      await x(
        `UPDATE "routine" SET one_off_until = created_at + interval '336 hours'
         WHERE id IN (SELECT id FROM "routine" WHERE user_id = $1::uuid ORDER BY id LIMIT 20)`, u);
      const seen = captureStatements(db);
      seen.length = 0;
      const t0 = Date.now();
      const list = (await routines().list(u)).routines;
      const ms = Date.now() - t0;
      expect(list).toHaveLength(50);
      expect(list.slice(0, 20).every((r) => r.oneOffUntil !== null)).toBe(true);
      expect(seen).toHaveLength(2);
      expect(ms).toBeLessThan(LIST_BOUND_MS);
    });
  });
});
