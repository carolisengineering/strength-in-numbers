import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { MODALITY_VALUES } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import {
  ExerciseImmutableError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  ExerciseTypeLockedError,
  NotFoundError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, TRUNCATE_ALL, type SetSpec } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));

/**
 * Spec 03.4 Phase A against a real Postgres: the type-change rule on PATCH (AC5–AC16, AC19). The statement log is
 * a thin proxy over the client, so a test can say "no set query ran" without mocking the repository.
 */
describe.skipIf(!shouldRunIntegration())("Spec 03.4 Phase A — the exercise type-change rule (real Postgres)", () => {
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

  /** The repository over a client that records every raw statement's text. */
  function watched() {
    const statements: string[] = [];
    // The full text, nested Prisma.sql fragments included (the type rule is one).
    const record = (first: unknown, values: unknown[]) => {
      statements.push(Array.isArray(first) ? Prisma.sql(first as unknown as TemplateStringsArray, ...values).sql : String((first as { sql?: string }).sql ?? first));
    };
    const client = new Proxy(db.prisma, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if ((prop === "$queryRaw" || prop === "$executeRaw") && typeof value === "function") {
          return (first: unknown, ...rest: unknown[]) => {
            record(first, rest);
            return (value as (...a: unknown[]) => unknown).call(target, first, ...rest);
          };
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as PrismaClient;
    return { repo: createExerciseRepository(client), statements, touchedSets: () => statements.some((s) => s.includes("set_entry")) };
  }
  const repo = () => createExerciseRepository(db.prisma);

  async function owned(user: string, modality = "weight_reps") {
    return insertExercise(db, { ownerUserId: user, modality });
  }
  async function logOn(user: string, exerciseId: string, modality: string, sets: SetSpec[], opts: { finish?: "raw" | "none"; d?: number } = {}) {
    return logWorkout(db, user, { startedAt: day(opts.d ?? 1), ...(opts.finish ? { finish: opts.finish } : {}), exercises: [{ exerciseId, modality, sets }] });
  }
  const stored = async (id: string) =>
    (await db.prisma.$queryRawUnsafe<{ modality: string; updated_at: Date; change_xid: string }[]>(
      `SELECT modality, updated_at, change_xid::text FROM "exercise" WHERE id = $1::uuid`, id))[0]!;

  describe("03.4 AC5 — no logged sets: every type is allowed", () => {
    it.each(["weight_reps", "calories"] as const)("from %s to each of the eight types", async (from) => {
      const user = await insertUser(db);
      for (const to of MODALITY_VALUES) {
        const id = await owned(user, from);
        const { exercise } = await repo().updateExercise(user, id, { modality: to });
        expect(exercise.modality).toBe(to);
        expect((await stored(id)).modality).toBe(to);
      }
    });
  });

  describe("03.4 AC6 — logged sets: an incompatible change is refused and nothing changes", () => {
    it("409 exercise-type-locked; modality, updated_at and change_xid are unchanged", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }]);
      const before = await stored(id);
      await expect(repo().updateExercise(user, id, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
      expect(await stored(id)).toEqual(before);
    });
  });

  describe("03.4 AC7 — the one compatible pair, both ways", () => {
    it("weight_reps ↔ weighted_bodyweight apply; a name rides along", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }]);
      const there = await repo().updateExercise(user, id, { name: "New", modality: "weighted_bodyweight" });
      expect(there).toMatchObject({ exercise: { name: "New", modality: "weighted_bodyweight" }, modalityChanged: true });
      expect((await repo().updateExercise(user, id, { modality: "weight_reps" })).exercise.modality).toBe("weight_reps");
    });
  });

  describe("03.4 AC8 — an unchanged type is no change", () => {
    it("Review Focus 1 — the full form with the stored type applies and never reads sets", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }]);
      const w = watched();
      const result = await w.repo.updateExercise(user, id, { name: "Renamed", modality: "weight_reps" });
      expect(result).toMatchObject({ exercise: { name: "Renamed", modality: "weight_reps" }, modalityChanged: false });
      expect(w.touchedSets()).toBe(false);
    });
  });

  describe("03.4 AC9 — any set_entry row locks the type", () => {
    it.each<[string, SetSpec, "raw" | "none"]>([
      ["a warm-up", { setType: "warmup", reps: 5, weight: 40 }, "raw"],
      ["a drop set", { setType: "drop", reps: 5, weight: 40 }, "raw"],
      ["a failure set", { setType: "failure", reps: 0, weight: 40 }, "raw"],
      ["an incomplete set", { reps: 5, weight: 40, isComplete: false }, "raw"],
      ["a set in a live workout", { reps: 5, weight: 40 }, "none"],
      ["a set in a finished workout", { reps: 5, weight: 40 }, "raw"],
    ])("%s", async (_label, set, finish) => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [set], { finish });
      await expect(repo().updateExercise(user, id, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
    });
    it("a workout card with no sets does not", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", []);
      expect((await repo().updateExercise(user, id, { modality: "duration" })).exercise.modality).toBe("duration");
    });
  });

  describe("03.4 AC10 — through the built-in", () => {
    it("a fork whose built-in parent holds the caller's sets refuses incompatible, allows compatible", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await logOn(user, builtIn, "weight_reps", [{ reps: 5, weight: 100 }]);
      const fork = await repo().forkExercise(user, builtIn, {});
      await expect(repo().updateExercise(user, fork.id, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
      expect((await repo().updateExercise(user, fork.id, { modality: "weighted_bodyweight" })).exercise.modality).toBe("weighted_bodyweight");
    });
  });

  describe("03.4 AC11 — through a retired sibling", () => {
    it("sets under a deleted first fork lock the second fork", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      const first = await repo().forkExercise(user, builtIn, {});
      await logOn(user, first.id, "weight_reps", [{ reps: 5, weight: 100 }]);
      await repo().deleteExercise(user, first.id);
      const second = await repo().forkExercise(user, builtIn, {});
      await expect(repo().updateExercise(user, second.id, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
    });
  });

  describe("03.4 AC12 — scoped to the caller", () => {
    it("Review Focus 2 — another user's sets on the built-in never lock the caller's fork", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await logOn(b, builtIn, "weight_reps", [{ reps: 5, weight: 100 }]);
      const fork = await repo().forkExercise(a, builtIn, {});
      expect((await repo().updateExercise(a, fork.id, { modality: "calories" })).exercise.modality).toBe("calories");
    });
    it("the caller's sets on an unrelated exercise never lock this one", async () => {
      const user = await insertUser(db);
      const other = await owned(user);
      await logOn(user, other, "weight_reps", [{ reps: 5, weight: 100 }]);
      const id = await owned(user);
      expect((await repo().updateExercise(user, id, { modality: "calories" })).exercise.modality).toBe("calories");
    });
  });

  describe("03.4 AC13 — other fields never consult sets", () => {
    it("name and the nullable references, cleared, apply with no set query", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }]);
      const w = watched();
      const { exercise } = await w.repo.updateExercise(user, id, { name: "Plain", primaryMuscleId: null, secondaryMuscleIds: [], equipmentId: null });
      expect(exercise).toMatchObject({ name: "Plain", primaryMuscleId: null, secondaryMuscleIds: [], equipmentId: null });
      expect(w.touchedSets()).toBe(false);
    });
  });

  describe("03.4 AC14 — check order: the type rule comes last", () => {
    it("malformed id → 404; another user's exercise → 404 (Review Focus 3)", async () => {
      const a = await insertUser(db);
      const b = await insertUser(db);
      const theirs = await owned(b);
      await logOn(b, theirs, "weight_reps", [{ reps: 5, weight: 100 }]);
      await expect(repo().updateExercise(a, "not-a-uuid", { modality: "duration" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(repo().updateExercise(a, theirs, { modality: "duration" })).rejects.toBeInstanceOf(NotFoundError);
    });
    it("retired → exercise-retired; built-in → exercise-immutable-use-fork; bad reference → 422", async () => {
      const user = await insertUser(db);
      const retired = await owned(user);
      await logOn(user, retired, "weight_reps", [{ reps: 5, weight: 100 }]);
      await repo().deleteExercise(user, retired);
      await expect(repo().updateExercise(user, retired, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseRetiredError);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await logOn(user, builtIn, "weight_reps", [{ reps: 5, weight: 100 }], { d: 2 });
      await expect(repo().updateExercise(user, builtIn, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseImmutableUseForkError);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }], { d: 3 });
      await expect(repo().updateExercise(user, id, { modality: "duration", primaryMuscleId: "no-such-muscle" })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("03.4 AC16 — a type change touches only the exercise row", () => {
    it("snapshots, sets and records are byte-identical; a rebuild agrees; no lock or recompute ran", async () => {
      const user = await insertUser(db);
      const id = await owned(user);
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 100 }], { d: 1 });
      await logOn(user, id, "weight_reps", [{ reps: 3, weight: 110 }], { d: 2 });
      await logOn(user, id, "weight_reps", [{ reps: 5, weight: 90 }], { d: 3, finish: "none" });
      const silent = pino({ level: "silent" });
      await rebuildRecords(db.prisma, silent, { userId: user });
      const hash = async () =>
        db.prisma.$queryRawUnsafe<{ we: string; se: string; pr: string }[]>(`
          SELECT (SELECT md5(coalesce(string_agg(id::text || modality_snapshot, ',' ORDER BY id), '')) FROM "workout_exercise") AS we,
                 (SELECT md5(coalesce(string_agg(id::text || coalesce(reps::text,'') || coalesce(weight::text,'') || set_type || updated_at::text, ',' ORDER BY id), '')) FROM "set_entry") AS se,
                 (SELECT md5(coalesce(string_agg(exercise_id::text || record_type || value::text || source_set_entry_id::text, ',' ORDER BY exercise_id, record_type), '')) FROM "personal_record") AS pr`);
      const before = (await hash())[0];
      const w = watched();
      await w.repo.updateExercise(user, id, { modality: "weighted_bodyweight" });
      expect((await hash())[0]).toEqual(before);
      expect(w.statements.some((s) => /pg_advisory|personal_record/.test(s))).toBe(false);
      await rebuildRecords(db.prisma, silent, { userId: user });
      expect((await hash())[0]).toEqual(before);
    });
  });

  describe("03.4 AC19 — built-ins stay immutable", () => {
    it("PATCH is exercise-immutable-use-fork, DELETE is exercise-immutable; the row is unchanged", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      const before = await stored(builtIn);
      await expect(repo().updateExercise(user, builtIn, { name: "Mine" })).rejects.toBeInstanceOf(ExerciseImmutableUseForkError);
      await expect(repo().deleteExercise(user, builtIn)).rejects.toBeInstanceOf(ExerciseImmutableError);
      expect(await stored(builtIn)).toEqual(before);
    });
  });

  describe("03.4 AC17 — the fork overlay obeys the rule", () => {
    const activeCount = async (user: string) =>
      Number((await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "exercise" WHERE owner_user_id = $1::uuid AND is_active`, user))[0]!.n);
    it("with the caller's sets on the origin: incompatible is 409 and inserts nothing; compatible is 201", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await logOn(user, builtIn, "weight_reps", [{ reps: 5, weight: 100 }]);
      const before = await activeCount(user);
      await expect(repo().forkExercise(user, builtIn, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
      expect(await activeCount(user)).toBe(before);
      const forks = await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT id FROM "exercise" WHERE forked_from_exercise_id = $1::uuid`, builtIn);
      expect(forks).toEqual([]);
      expect((await repo().forkExercise(user, builtIn, { modality: "weighted_bodyweight" })).modality).toBe("weighted_bodyweight");
    });
    it("Review Focus 5 — the origin's own type is 201 and never reads sets", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await logOn(user, builtIn, "weight_reps", [{ reps: 5, weight: 100 }]);
      const w = watched();
      expect((await w.repo.forkExercise(user, builtIn, { modality: "weight_reps" })).modality).toBe("weight_reps");
      expect(w.touchedSets()).toBe(false);
    });
    it("with no sets in the lineage, every type forks", async () => {
      const user = await insertUser(db);
      for (const to of MODALITY_VALUES) {
        const builtIn = await insertExercise(db, { modality: "weight_reps" });
        expect((await repo().forkExercise(user, builtIn, { modality: to })).modality).toBe(to);
      }
    });
  });

  describe("03.4 AC18 — fork characterization", () => {
    it("a bodiless fork copies the origin and points at it; a name overlay applies; a second fork shares the root", async () => {
      const user = await insertUser(db);
      const builtIn = await insertExercise(db, { name: "Back Squat", modality: "weight_reps" });
      const first = await repo().forkExercise(user, builtIn, {});
      expect(first).toMatchObject({ name: "Back Squat", modality: "weight_reps", forkedFromExerciseId: builtIn, ownerUserId: user });
      const named = await repo().forkExercise(user, builtIn, { name: "My Squat" });
      expect(named).toMatchObject({ name: "My Squat", forkedFromExerciseId: builtIn });
      expect(new Set([first.forkedFromExerciseId, named.forkedFromExerciseId])).toEqual(new Set([builtIn]));
    });
    it("counts against the shared cap: the 500th succeeds, the 501st is exercise-limit-reached", async () => {
      const user = await insertUser(db);
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","owner_user_id","name","modality","is_active")
         SELECT gen_random_uuid(), $1::uuid, 'Seed ' || g, 'weight_reps', true FROM generate_series(1, 499) g`, user);
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      await expect(repo().forkExercise(user, builtIn, {})).resolves.toMatchObject({ ownerUserId: user });
      await expect(repo().forkExercise(user, builtIn, {})).rejects.toMatchObject({ slug: "exercise-limit-reached" });
    });
  });

  describe("03.4 AC6 / AC4 / AC18 — over HTTP", () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => {
      await app?.close();
      app = undefined;
    });
    const httpApp = () =>
      buildApp({
        config: testConfig(),
        logger: false,
        checkReadiness: () => checkDatabaseReady(db.prisma),
        tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|type-lock", email: "t@ex.com" })),
        userRepository: createUserRepository(db.prisma),
        exerciseRepository: createExerciseRepository(db.prisma),
        workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
        personalRecordRepository: createPersonalRecordRepository(db.prisma),
        routineRepository: createRoutineRepository(db.prisma),
        accountExportRepository: createAccountExportRepository(db.prisma),
        hevyRepository: createHevyRepository(db.prisma),
        hevyImportRepository: createHevyImportRepository(db.prisma),
        rateLimits: GENEROUS_LIMITS,
      });
    it("the fork route answers 201 with a Location for a bodiless fork", async () => {
      app = await httpApp();
      const headers = { authorization: "Bearer t", "content-type": "application/json" };
      await app.inject({ method: "GET", url: "/v1/me", headers });
      const builtIn = await insertExercise(db, { modality: "weight_reps" });
      const res = await app.inject({ method: "POST", url: `/v1/exercises/${builtIn}/fork`, headers: { authorization: "Bearer t" } });
      expect(res.statusCode).toBe(201);
      expect(res.headers.location).toBe(`/v1/exercises/${res.json().id}`);
    });
    it("the problem body, and a later delta does not contain the row", async () => {
      app = await httpApp();
      const headers = { authorization: "Bearer t", "content-type": "application/json" };
      const me = (await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { id: string };
      const id = await owned(me.id);
      await logOn(me.id, id, "weight_reps", [{ reps: 5, weight: 100 }]);
      const token = (await app.inject({ method: "GET", url: "/v1/exercises", headers })).json().syncToken as string;
      const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${id}`, headers, payload: { modality: "duration" } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        type: expect.stringMatching(/\/exercise-type-locked$/),
        title: "Exercise type locked",
        status: 409,
        detail: "This exercise already has logged sets, so its type can only change to one that logs the same measures. Create a new exercise instead.",
      });
      const delta = (await app.inject({ method: "GET", url: `/v1/exercises?since=${encodeURIComponent(token)}`, headers })).json() as { exercises: { id: string }[] };
      expect(delta.exercises.map((e) => e.id)).not.toContain(id);
    });
  });
});
