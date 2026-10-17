import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { ValidationError } from "../../src/errors/app-error.js";
import { encodeWorkoutCursor } from "../../src/repositories/workout-cursor.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, TRUNCATE_ALL } from "./records-helpers.js";
import { WorkoutHistoryResponseSchema } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000); // day n of 2026

describe.skipIf(!shouldRunIntegration())("Spec 07.1 — listFinishedWorkouts (real Postgres)", () => {
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
  const list = (userId: string, limit: number, cursor?: string) => repo().listFinishedWorkouts(userId, { limit, cursor });

  /** n finished, empty workouts on consecutive days; returns ids newest-first. */
  async function seedDays(userId: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let d = 0; d < n; d++) ids.push((await logWorkout(db, userId, { startedAt: at(d), exercises: [] })).workoutId);
    return ids.reverse();
  }

  /** Every page's ids, following `next` to the end. */
  async function pageAll(userId: string, limit: number): Promise<{ sizes: number[]; ids: string[] }> {
    const sizes: number[] = [];
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await list(userId, limit, cursor);
      sizes.push(page.items.length);
      ids.push(...page.items.map((w) => w.id));
      if (page.next === null) return { sizes, ids };
      cursor = page.next;
    }
  }

  describe("AC2 — the caller's finished workouts only", () => {
    it("excludes the in-progress workout and other users' rows", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const mine = await seedDays(a, 2);
      await logWorkout(db, a, { startedAt: at(10), finish: "none", exercises: [] });
      await seedDays(b, 3);
      expect((await list(a, 50)).items.map((w) => w.id)).toEqual(mine);
    });
  });

  describe("AC3 — order is started_at DESC, id DESC, exact to the microsecond", () => {
    it("ties break by id descending; microsecond differences order correctly", async () => {
      const u = await insertUser(db);
      const ids: string[] = [];
      for (let k = 0; k < 4; k++) ids.push((await logWorkout(db, u, { startedAt: at(1), exercises: [] })).workoutId);
      // two share 10:00:00.000000 (left as inserted), two differ only in micros
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET started_at = '2026-01-02T10:00:00.000001Z' WHERE id = $1::uuid`, ids[2]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET started_at = '2026-01-02T10:00:00.000002Z' WHERE id = $1::uuid`, ids[3]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET started_at = '2026-01-02T10:00:00.000000Z' WHERE id = ANY($1::uuid[])`, [ids[0], ids[1]]);
      const tied = [ids[0]!, ids[1]!].sort().reverse();
      const expected = [ids[3], ids[2], ...tied];
      expect((await pageAll(u, 1)).ids).toEqual(expected); // limit 1 crosses every boundary
    });
  });

  describe("AC4 — keyset paging has no gaps and no duplicates", () => {
    it("45 rows at limit 20 → 20/20/5, concatenation equals the full order", async () => {
      const u = await insertUser(db);
      const all = await seedDays(u, 45);
      const { sizes, ids } = await pageAll(u, 20);
      expect(sizes).toEqual([20, 20, 5]);
      expect(ids).toEqual(all);
    });
    it.each([20, 40])("exactly %i rows at limit 20 ends with next: null — no trailing empty page", async (n) => {
      const u = await insertUser(db);
      await seedDays(u, n);
      const { sizes } = await pageAll(u, 20);
      expect(sizes).toEqual(Array(n / 20).fill(20));
    });
    it("Review Focus 4 — 25 rows sharing one started_at page by id at limit 10", async () => {
      const u = await insertUser(db);
      const ids: string[] = [];
      for (let k = 0; k < 25; k++) ids.push((await logWorkout(db, u, { startedAt: at(3), exercises: [] })).workoutId);
      const { sizes, ids: got } = await pageAll(u, 10);
      expect(sizes).toEqual([10, 10, 5]);
      expect(got).toEqual([...ids].sort().reverse());
    });
  });

  describe("AC7 (repository) — a malformed cursor throws before any query", () => {
    it("ValidationError", async () => {
      const u = await insertUser(db);
      await expect(list(u, 20, "v1.***")).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("AC8 — a tampered or foreign cursor only moves within the caller's own rows", () => {
    it("B replaying A's next gets only B's rows; forged cursors are 200 caller-only", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      await seedDays(a, 5);
      const bIds = await seedDays(b, 3);
      const aNext = (await list(a, 2)).next!;
      const replay = await list(b, 50, aNext);
      expect(replay.items.every((w) => bIds.includes(w.id))).toBe(true);
      const future = encodeWorkoutCursor({ startedAtText: "2999-01-01T00:00:00.000000Z", id: uuidv7() });
      expect((await list(b, 50, future)).items.map((w) => w.id)).toEqual(bIds);
      const past = encodeWorkoutCursor({ startedAtText: "1999-01-01T00:00:00.000000Z", id: uuidv7() });
      expect(await list(b, 50, past)).toEqual({ items: [], next: null });
    });
  });

  describe("AC9 — deleting the cursor's row between pages is fine", () => {
    it("page 2 continues exactly where the full order says", async () => {
      const u = await insertUser(db);
      const all = await seedDays(u, 7);
      const p1 = await list(u, 3);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "workout" WHERE id = $1::uuid`, p1.items[2]!.id);
      const p2 = await list(u, 3, p1.next!);
      expect(p2.items.map((w) => w.id)).toEqual(all.slice(3, 6));
    });
  });

  describe("AC10 — a backdated workout finished mid-scroll lands in its sorted slot", () => {
    it("below the position: appears in the remaining pages; above it: only on a fresh page 1", async () => {
      const u = await insertUser(db);
      await seedDays(u, 6); // days 0..5, newest first: 5,4,3,2,1,0
      const p1 = await list(u, 3); // days 5,4,3
      const below = (await logWorkout(db, u, { startedAt: new Date(at(1).getTime() + 3_600_000), exercises: [] })).workoutId;
      const above = (await logWorkout(db, u, { startedAt: at(9), exercises: [] })).workoutId;
      const rest = await list(u, 50, p1.next!);
      expect(rest.items.map((w) => w.id)).toContain(below);
      expect(rest.items.map((w) => w.id)).not.toContain(above);
      expect((await list(u, 1)).items[0]!.id).toBe(above);
    });
  });

  describe("AC11 — empty history", () => {
    it("{ items: [], next: null }", async () => {
      const u = await insertUser(db);
      expect(await list(u, 20)).toEqual({ items: [], next: null });
    });
  });

  describe("AC12 — counts and names", () => {
    it("names by position (3 of 5), exerciseCount, working-set count incl. unticked, excl. warmup/drop/failure", async () => {
      const u = await insertUser(db);
      const ex = await Promise.all([0, 1, 2, 3, 4].map(() => insertExercise(db)));
      await logWorkout(db, u, {
        startedAt: at(1),
        exercises: [
          { exerciseId: ex[0]!, name: "E", position: 4, sets: [{ reps: 5, weight: 50 }] },
          { exerciseId: ex[1]!, name: "C", position: 2, sets: [] },
          { exerciseId: ex[2]!, name: "A", position: 0, sets: [{ reps: 5, weight: 50, isComplete: false }, { setType: "warmup", reps: 5, weight: 20 }] },
          { exerciseId: ex[3]!, name: "D", position: 3, sets: [{ setType: "drop", reps: 5, weight: 40 }, { setType: "failure", reps: 1, weight: 60 }] },
          { exerciseId: ex[4]!, name: "B", position: 1, sets: [{ reps: 8, weight: 30 }] },
        ],
      });
      await logWorkout(db, u, { startedAt: at(0), exercises: [] });
      const [full, empty] = (await list(u, 10)).items;
      expect(full).toMatchObject({ exerciseCount: 5, exerciseNames: ["A", "B", "C"], workingSetCount: 3 });
      expect(empty).toMatchObject({ exerciseCount: 0, exerciseNames: [], workingSetCount: 0, totalVolumeMilli: null });
    });
  });

  describe("AC13 — totalVolume is exact and shares 07.0's eligibility", () => {
    it("hand-computed mixed workout", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const dips = await insertExercise(db, { modality: "weighted_bodyweight" });
      const pullup = await insertExercise(db, { modality: "bodyweight_reps" });
      await logWorkout(db, u, {
        startedAt: at(1),
        exercises: [
          // 100 kg × 5 = 500.000; 135 lb → weight_kg 61.235 × 3 = 183.705; warm-up excluded; reps 0 excluded
          { exerciseId: bench, sets: [{ reps: 5, weight: 100 }, { reps: 3, weight: 135, weightUnit: "lb" }, { setType: "warmup", reps: 10, weight: 60 }, { reps: 0, weight: 120 }] },
          // weighted_bodyweight 20 kg × 8 = 160.000
          { exerciseId: dips, modality: "weighted_bodyweight", sets: [{ reps: 8, weight: 20 }] },
          // bodyweight_reps contributes nothing
          { exerciseId: pullup, modality: "bodyweight_reps", sets: [{ reps: 12 }] },
          // Review Focus 5: a half-filled working set (null weight) contributes nothing
          { exerciseId: bench, sets: [{ reps: 5, weight: null }] },
        ],
      });
      // total = 500.000 + 183.705 + 160.000 = 843.705 kg·reps
      expect((await list(u, 1)).items[0]!.totalVolumeMilli).toBe(843_705);
    });
    it.each([
      ["cardio-only", { modality: "duration", sets: [{ durationS: 600 }] }],
      ["bodyweight-only", { modality: "bodyweight_reps", sets: [{ reps: 10 }] }],
      ["reps 0", { modality: "weight_reps", sets: [{ reps: 0, weight: 100 }] }],
      ["weight 0", { modality: "weight_reps", sets: [{ reps: 5, weight: 0 }] }],
      ["Review Focus 5 — only null measures", { modality: "weight_reps", sets: [{ reps: null, weight: null }] }],
    ] as const)("%s → null", async (_label, spec) => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { modality: spec.modality });
      await logWorkout(db, u, { startedAt: at(1), exercises: [{ exerciseId: ex, modality: spec.modality, sets: [...spec.sets] }] });
      expect((await list(u, 1)).items[0]!.totalVolumeMilli).toBeNull();
    });
  });

  describe("AC14 / 07.3 AC1 / 07.3 AC4 — recordCount is the records a workout holds now, set volume excluded", () => {
    it("matches personal_record and drops after a backdated finish takes a tie", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const w = repo();
      const finish = async (day: number) => {
        const { workoutId } = await logWorkout(db, u, { startedAt: at(day), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
        await w.updateWorkout(u, workoutId, { endedAt: new Date(at(day).getTime() + 3_600_000).toISOString() });
        return workoutId;
      };
      const later = await finish(10);
      expect((await list(u, 1)).items[0]).toMatchObject({ id: later, recordCount: 2 }); // 07.3: heaviest weight + est. 1RM; set volume is not counted
      await finish(5); // backdated, ties every record → earliest wins
      const rows = (await list(u, 10)).items;
      expect(rows.find((r) => r.id === later)!.recordCount).toBe(0);
      const counts = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "personal_record" WHERE workout_id = $1::uuid`, later);
      expect(counts[0]!.n).toBe(0);
    });
  });

  describe("07.3 AC2 — a volume-only workout counts zero", () => {
    it("lists recordCount 0 while the set-volume row still exists", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: at(1), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      await repo().updateWorkout(u, workoutId, { endedAt: new Date(at(1).getTime() + 3_600_000).toISOString() });
      await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record" WHERE workout_id = $1::uuid AND record_type <> 'best_set_volume'`, workoutId);
      expect((await list(u, 1)).items[0]).toMatchObject({ id: workoutId, recordCount: 0 });
      const rows = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "personal_record" WHERE workout_id = $1::uuid`, workoutId);
      expect(rows[0]!.n).toBe(1);
    });
  });

  describe("07.3 AC3 — other record types still count", () => {
    const finishOne = async (u: string, exercises: { exerciseId: string; modality?: string; sets: { reps: number; weight?: number }[] }[]) => {
      const { workoutId } = await logWorkout(db, u, { startedAt: at(1), finish: "none", exercises });
      await repo().updateWorkout(u, workoutId, { endedAt: new Date(at(1).getTime() + 3_600_000).toISOString() });
      return workoutId;
    };
    const types = async (workoutId: string) =>
      (await db.prisma.$queryRawUnsafe<{ record_type: string }[]>(`SELECT record_type FROM "personal_record" WHERE workout_id = $1::uuid`, workoutId)).map((r) => r.record_type);

    it("a max_reps record is counted", async () => {
      const u = await insertUser(db);
      const pushups = await insertExercise(db, { modality: "bodyweight_reps" });
      const id = await finishOne(u, [{ exerciseId: pushups, modality: "bodyweight_reps", sets: [{ reps: 20 }] }]);
      const held = await types(id);
      expect(held).toContain("max_reps");
      expect((await list(u, 1)).items[0]!.recordCount).toBe(held.filter((t) => t !== "best_set_volume").length);
      expect((await list(u, 1)).items[0]!.recordCount).toBeGreaterThanOrEqual(1);
    });

    it("three types across a weight_reps and a bodyweight_reps exercise count three", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const pushups = await insertExercise(db, { modality: "bodyweight_reps" });
      const id = await finishOne(u, [
        { exerciseId: bench, sets: [{ reps: 5, weight: 100 }] },
        { exerciseId: pushups, modality: "bodyweight_reps", sets: [{ reps: 20 }] },
      ]);
      expect(await types(id)).toEqual(expect.arrayContaining(["heaviest_weight", "best_est_1rm", "best_set_volume", "max_reps"]));
      expect((await list(u, 1)).items[0]).toMatchObject({ id, recordCount: 3 });
    });
  });

  describe("07.3 AC5 — the finish response still lists set volume", () => {
    it("newRecords has 3 entries while the History row says 2", async () => {
      const u = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: at(1), finish: "none", exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }] });
      const finished = await repo().updateWorkout(u, workoutId, { endedAt: new Date(at(1).getTime() + 3_600_000).toISOString() });
      expect(finished.newRecords).toHaveLength(3);
      expect(finished.newRecords.map((r) => r.recordType)).toContain("best_set_volume");
      expect((await list(u, 1)).items[0]).toMatchObject({ id: workoutId, recordCount: 2 });
    });
  });

  describe("AC1 (HTTP) — the real wiring", () => {
    it("pages a user's history over HTTP with a schema-valid body", async () => {
      const app = await buildApp({
        config: testConfig(),
        logger: false,
        checkReadiness: () => checkDatabaseReady(db.prisma),
        tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|history", email: "h@ex.com" })),
        userRepository: createUserRepository(db.prisma),
        exerciseRepository: createExerciseRepository(db.prisma),
        workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
        personalRecordRepository: createPersonalRecordRepository(db.prisma),
        routineRepository: createRoutineRepository(db.prisma),
        accountExportRepository: createAccountExportRepository(db.prisma),
        rateLimits: GENEROUS_LIMITS,
      });
      try {
        const headers = { authorization: "Bearer t" };
        const userId = (await app.inject({ method: "GET", url: "/v1/me", headers })).json().id as string;
        const all = await seedDays(userId, 3);
        const p1 = await app.inject({ method: "GET", url: "/v1/workouts?limit=2", headers });
        expect(p1.statusCode).toBe(200);
        const b1 = WorkoutHistoryResponseSchema.parse(p1.json());
        const p2 = WorkoutHistoryResponseSchema.parse(
          (await app.inject({ method: "GET", url: `/v1/workouts?limit=2&cursor=${b1.next}`, headers })).json(),
        );
        expect([...b1.items, ...p2.items].map((w) => w.id)).toEqual(all);
        expect(p2.next).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
