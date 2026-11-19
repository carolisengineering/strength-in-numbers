import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { liftsWithBeatenRecords, PersonalRecordsResponseSchema, WorkoutHistoryResponseSchema } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { appRepositories, shouldRunIntegration, startIntegrationDb, type AppIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { insertExercise, logWorkout, TRUNCATE_ALL, type ExerciseSpec } from "./records-helpers.js";

/**
 * Spec 07.6 Phase A from the outside, over HTTP on the `sin_app` login with RLS on: History's `recordCount` against the
 * workout's own records (AC7), the statement's text (AC5), another user's records (AC11) and the page's statement count
 * (AC11). Fixtures are logged on the owner client and finished through the repository, so the PR recompute runs.
 */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);

describe.skipIf(!shouldRunIntegration())("Spec 07.6 — History counts lifts (HTTP, sin_app)", () => {
  let db: AppIntegrationDb;
  /** The app login as an `IntegrationDb`, so the statement capture listens to what the API sends. Built once (one listener). */
  let appDb: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    appDb = { ...db, prisma: db.app };
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  const repo = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

  /** An app for one signed-in lifter; `userId` is provisioned by `/v1/me`. */
  async function lifter(sub: string) {
    const app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.app),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: `auth0|${sub}`, email: `${sub}@ex.com` })),
      ...appRepositories(db.app),
      rateLimits: GENEROUS_LIMITS,
    });
    const headers = { authorization: "Bearer t" };
    const userId = (await app.inject({ method: "GET", url: "/v1/me", headers })).json().id as string;
    const finishAt = async (day: number, exercises: ExerciseSpec[]) => {
      const { workoutId } = await logWorkout(db, userId, { startedAt: at(day), finish: "none", exercises });
      await repo().updateWorkout(userId, workoutId, { endedAt: new Date(at(day).getTime() + 3_600_000).toISOString() });
      return workoutId;
    };
    const recordCount = async (workoutId: string) => {
      const body = WorkoutHistoryResponseSchema.parse((await app.inject({ method: "GET", url: "/v1/workouts?limit=50", headers })).json());
      return body.items.find((w) => w.id === workoutId)!.recordCount;
    };
    const records = async (workoutId: string) =>
      PersonalRecordsResponseSchema.parse((await app.inject({ method: "GET", url: `/v1/personal-records?workoutId=${workoutId}`, headers })).json()).records;
    return { app, headers, userId, finishAt, recordCount, records };
  }
  type Lifter = Awaited<ReturnType<typeof lifter>>;

  const set = (weight: number, reps: number, weightUnit?: "kg" | "lb") => ({ weight, reps, ...(weightUnit ? { weightUnit } : {}) });

  /** Each fixture logs history and returns the workout to count, with the count the rule gives. */
  const FIXTURES: [name: string, expected: number, build: (l: Lifter) => Promise<string>][] = [
    ["weight-and-estimate-one-lift", 1, async (l) => {
      const bench = await insertExercise(db);
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]);
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(102.5, 5)] }]);
    }],
    ["first-only-lift", 0, async (l) => l.finishAt(1, [{ exerciseId: await insertExercise(db), sets: [set(100, 5)] }])],
    ["mixed-lift", 1, async (l) => {
      const bench = await insertExercise(db);
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(60, 15)] }]); // no estimate above 12 reps
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(62.5, 5)] }]); // weight beaten, estimate first
    }],
    ["volume-only", 0, async (l) => {
      const bench = await insertExercise(db);
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]);
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(80, 10)] }]);
    }],
    ["fork-and-origin", 1, async (l) => {
      const bench = await insertExercise(db);
      const fork = await insertExercise(db, { ownerUserId: l.userId, forkedFrom: bench });
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]);
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(102.5, 5)] }, { exerciseId: fork, sets: [set(105, 5)] }]);
    }],
    ["seven-lifts", 7, async (l) => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push(await insertExercise(db));
      await l.finishAt(1, ids.map((exerciseId) => ({ exerciseId, sets: [set(50, 5)] })));
      return l.finishAt(2, ids.map((exerciseId) => ({ exerciseId, sets: [set(52.5, 5)] })));
    }],
    // D9: the summary draws these lifts uncounted (their gains round away); History counts them.
    ["lone-rounded-zero-e1rm", 1, async (l) => {
      const bench = await insertExercise(db);
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]); // e1RM 116.667
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(97.25, 6)] }]); // e1RM 116.700: both read 116.5 kg
    }],
    ["lb-equal-weights", 1, async (l) => {
      const bench = await insertExercise(db);
      await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]); // 100 kg = 220.5 lb on screen
      return l.finishAt(2, [{ exerciseId: bench, sets: [set(220.5, 5, "lb")] }]); // stored 100.017 kg, also 220.5 lb
    }],
  ];

  describe("07.6 AC7 — recordCount equals liftsWithBeatenRecords over the workout's records", () => {
    it.each(FIXTURES)("%s counts %i", async (name, expected, build) => {
      const l = await lifter(name);
      try {
        const workoutId = await build(l);
        const records = await l.records(workoutId);
        expect(await l.recordCount(workoutId)).toBe(liftsWithBeatenRecords(records));
        expect(await l.recordCount(workoutId)).toBe(expected);
        if (name === "lone-rounded-zero-e1rm" || name === "lb-equal-weights") {
          // The fixture is what it claims: every beaten non-volume row rose by a sliver, never an ordinary rise.
          const beaten = records.filter((r) => r.recordType !== "best_set_volume" && r.previousValue !== null);
          expect(beaten.length).toBeGreaterThan(0);
          for (const r of beaten) expect(r.value - r.previousValue!).toBeLessThan(0.25);
        }
        if (name === "lone-rounded-zero-e1rm") {
          expect(records.filter((r) => r.previousValue !== null && r.recordType !== "best_set_volume").map((r) => r.recordType)).toEqual(["best_est_1rm"]);
        }
      } finally {
        await l.app.close();
      }
    });
  });

  describe("07.6 AC5 — the count is the stored fact: no function call, no rounding", () => {
    it("the page statement counts distinct roots with a previous value, and does no arithmetic on values", async () => {
      const l = await lifter("ac5");
      try {
        await l.finishAt(1, [{ exerciseId: await insertExercise(db), sets: [set(100, 5)] }]);
        const seen = await startCapture(appDb);
        await l.app.inject({ method: "GET", url: "/v1/workouts?limit=20", headers: l.headers });
        await settleCapture(appDb, seen);
        const page = seen.find((q) => q.includes("record_count"));
        expect(page).toBeDefined();
        expect(page).toContain("count(DISTINCT pr.exercise_id)");
        expect(page).toContain("pr.previous_value IS NOT NULL");
        expect(page).toContain("pr.user_id = w.user_id");
        expect(page).not.toMatch(/round\(|estimate|value\s*-/i);
      } finally {
        await l.app.close();
      }
    });
  });

  describe("07.6 AC11 — after Spec 21.1: other users, and the page's statement count", () => {
    it("another user's records in the same weeks never change A's count", async () => {
      const a = await lifter("a");
      const b = await lifter("b");
      try {
        const bench = await insertExercise(db);
        await a.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]);
        const aWeek2 = await a.finishAt(8, [{ exerciseId: bench, sets: [set(102.5, 5)] }]);
        expect(await a.recordCount(aWeek2)).toBe(1);
        await b.finishAt(1, [{ exerciseId: bench, sets: [set(140, 5)] }]);
        await b.finishAt(8, [{ exerciseId: bench, sets: [set(150, 5)] }]);
        expect(await a.recordCount(aWeek2)).toBe(1);
      } finally {
        await a.app.close();
        await b.app.close();
      }
    });

    it("a History page sends the same number of statements as before the change", async () => {
      const l = await lifter("statements");
      try {
        const bench = await insertExercise(db);
        await l.finishAt(1, [{ exerciseId: bench, sets: [set(100, 5)] }]);
        await l.finishAt(2, [{ exerciseId: bench, sets: [set(102.5, 5)] }]);
        const seen = await startCapture(appDb);
        expect((await l.app.inject({ method: "GET", url: "/v1/workouts?limit=20", headers: l.headers })).statusCode).toBe(200);
        await settleCapture(appDb, seen);
        expect(seen.length).toBe(12); // the same as the old row-count subquery measured (and 21.1 AC19's figure through the handle)
      } finally {
        await l.app.close();
      }
    });
  });
});
