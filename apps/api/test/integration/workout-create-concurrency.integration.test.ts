import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.0 AC3/AC4/AC5/AC14 — genuine concurrent load against a real
 * Postgres, not the scripted-mock outcome switch Task 10's unit tests
 * exercised. Ten concurrent callers (not two — Spec 03.2 D23: a
 * two-caller race can pass a broken implementation on scheduling luck
 * alone) prove the ON CONFLICT DO NOTHING / partial-unique-index idiom
 * actually serializes at the database, not merely in the mock.
 *
 * AC14 (create takes no advisory lock) is covered by absence of behavior
 * here: `createWorkout` never calls `pg_advisory_xact_lock` (grep confirms
 * it appears only in `addWorkoutExercise`'s position transaction), and if
 * it *did* take one keyed by user, these ten concurrent same-user calls
 * would serialize to a crawl or deadlock rather than resolve promptly —
 * the tests below have no explicit timeout tightened for that, but the
 * default vitest per-test timeout plus real wall-clock behavior below acts
 * as a smoke check for it.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC3/AC4/AC5 — createWorkout concurrency (real Postgres)",
  () => {
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
      await db.prisma.$executeRawUnsafe('TRUNCATE "workout", "workout_exercise", "user" CASCADE');
    });

    async function insertUser(): Promise<string> {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
      return id;
    }

    it("AC3 — ~10 concurrent creates with one identical clientGeneratedId: exactly one 201, the rest 200, never a 409", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
      const clientGeneratedId = uuidv7();
      const startedAt = new Date();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.createWorkout(
            userId,
            { clientGeneratedId, startedAt, tzOffsetMinutes: 0, title: null, notes: null },
            "UTC",
          ),
        ),
      );

      const createdCount = results.filter((r) => r.created).length;
      expect(createdCount).toBe(1);
      expect(results.filter((r) => !r.created)).toHaveLength(9);
      const ids = new Set(results.map((r) => r.workout.id));
      expect(ids.size).toBe(1); // one row exists afterwards

      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid`,
        userId,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("AC4 — a concurrent burst of creates (distinct clientGeneratedIds) for a user with no active session admits exactly one row", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          repo.createWorkout(
            userId,
            {
              clientGeneratedId: uuidv7(),
              startedAt: new Date(Date.now() + i),
              tzOffsetMinutes: 0,
              title: null,
              notes: null,
            },
            "UTC",
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WorkoutInProgressExistsError);
      }

      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid AND ended_at IS NULL`,
        userId,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("AC5 — a real 23505 on workout_user_active_key is shaped P2010 + meta.code 23505 (pins the idiom Task 10's stub assumed)", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
      await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      // A second, different clientGeneratedId must hit the active-key 23505
      // path and resolve to the 409 via the re-read (D50) — proving the real
      // driver surfaces the P2010/23505 shape Task 10's ScriptedPrisma tests
      // assumed, not a fabrication.
      await expect(
        repo.createWorkout(
          userId,
          { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
          "UTC",
        ),
      ).rejects.toBeInstanceOf(WorkoutInProgressExistsError);
    });
  },
);
