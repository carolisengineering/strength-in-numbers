// apps/api/test/integration/rls-policies.integration.test.ts
// Spec 21.1 AC35 — the risky paths, as sin_app with RLS on. "Refused" means SQLSTATE 42501.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createScopedDb } from "../../src/db/scoped.js";
import { NotFoundError } from "../../src/errors/app-error.js";
import { rawSqlState } from "../../src/repositories/pg-errors.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { appRepositories, insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { importWorkoutFixture, seedPairs } from "./hevy-import-helpers.js";
import { seedEveryTable, type SeededUser } from "./rls-seed.js";

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC35 — the risky paths as sin_app (real Postgres)", () => {
  let db: AppIntegrationDb;
  let a: SeededUser;
  let b: SeededUser;
  let globalExercise: string;
  let app: FastifyInstance | undefined;

  const asUser = <T>(who: string, run: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.app.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${who}, true)`;
      return run(tx);
    });

  const stateOf = async (run: () => Promise<unknown>): Promise<string | null> => {
    try {
      await run();
      return null;
    } catch (err) {
      return rawSqlState(err);
    }
  };

  const subOf = async (id: string) =>
    (await db.prisma.$queryRaw<{ auth_sub: string }[]>`SELECT auth_sub FROM "user" WHERE id = ${id}::uuid`)[0]!.auth_sub;

  /**
   * The real app on `sin_app`, with a token's email read from `emails` on each request so a test can change it. A token
   * is its own subject: `Bearer x` signs in as `auth0|x`.
   */
  const makeApp = async (emails: Record<string, string> = {}): Promise<FastifyInstance> => {
    app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.app),
      tokenVerifier: fakeVerifier((token) => authContext({ authSub: `auth0|${token}`, email: emails[token] ?? `${token}@ex.com` })),
      ...appRepositories(db.app),
      rateLimits: GENEROUS_LIMITS,
    });
    return app;
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    a = await seedEveryTable(db, await insertUser(db));
    b = await seedEveryTable(db, await insertUser(db));
    globalExercise = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
  }, 180_000);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe("AC35 — row locks on catalog rows", () => {
    const lock = (id: string) =>
      asUser(a.userId, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "exercise" WHERE id = ${id}::uuid FOR SHARE`);

    it("FOR SHARE on a global exercise returns its row", async () => {
      expect((await lock(globalExercise)).map((r) => r.id)).toEqual([globalExercise]);
    });

    it("FOR SHARE on the caller's own custom exercise returns its row", async () => {
      expect((await lock(a.customExercise)).map((r) => r.id)).toEqual([a.customExercise]);
    });

    it("FOR SHARE on another user's custom exercise returns no row", async () => {
      expect(await lock(b.customExercise)).toEqual([]);
    });
  });

  describe("AC35 — row locks on the user row", () => {
    const lock = (id: string) =>
      asUser(a.userId, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "user" WHERE id = ${id}::uuid FOR NO KEY UPDATE`);

    it("FOR NO KEY UPDATE on the caller's row returns it", async () => {
      expect((await lock(a.userId)).map((r) => r.id)).toEqual([a.userId]);
    });

    it("FOR NO KEY UPDATE on another user's row returns no row", async () => {
      expect(await lock(b.userId)).toEqual([]);
    });
  });

  describe("AC35 — exercise writes", () => {
    const nameOf = async (id: string) => (await db.prisma.$queryRaw<{ name: string }[]>`SELECT name FROM "exercise" WHERE id = ${id}::uuid`)[0]!.name;

    it("an UPDATE of a global exercise is refused and leaves the row unchanged", async () => {
      const before = await nameOf(globalExercise);
      const state = await stateOf(() => asUser(a.userId, (tx) => tx.$executeRaw`UPDATE "exercise" SET name = 'Mine now' WHERE id = ${globalExercise}::uuid`));
      expect(state).toBe("42501");
      expect(await nameOf(globalExercise)).toBe(before);
    });

    it("setting owner_user_id on the caller's own row is refused (no column privilege)", async () => {
      const state = await stateOf(() =>
        asUser(a.userId, (tx) => tx.$executeRaw`UPDATE "exercise" SET owner_user_id = ${a.userId}::uuid WHERE id = ${a.customExercise}::uuid`),
      );
      expect(state).toBe("42501");
    });

    it("an UPDATE of another user's exercise changes nothing", async () => {
      const before = await nameOf(b.customExercise);
      expect(await asUser(a.userId, (tx) => tx.$executeRaw`UPDATE "exercise" SET name = 'Taken' WHERE id = ${b.customExercise}::uuid`)).toBe(0);
      expect(await nameOf(b.customExercise)).toBe(before);
    });
  });

  describe("AC35 — the account export", () => {
    it("the snapshot holds the caller's data and none of another user's ids", async () => {
      const snapshot = await appRepositories(db.app).accountExportRepository.snapshot(a.userId);
      expect(snapshot.workouts.map((w) => w.id)).toEqual([a.workoutId]);
      expect(snapshot.routines).toHaveLength(1);
      const text = JSON.stringify(snapshot, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
      expect(text).toContain(a.customExercise);
      for (const id of [b.userId, b.workoutId, b.customExercise]) expect(text).not.toContain(id);
    });

    it("Spec 11 AC7's probe holds: repeatable read, read only, the user set, a write inside fails 25006", async () => {
      let probe: { iso: string; ro: string; who: string | null } | undefined;
      let writeState: string | null = null;
      const repo = createAccountExportRepository(createScopedDb(db.app), {
        afterExercises: async (tx) => {
          [probe] = await tx.$queryRaw<{ iso: string; ro: string; who: string | null }[]>`
            SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro,
                   NULLIF(current_setting('app.user_id', true), '') AS who`;
          await tx.$executeRaw`SAVEPOINT probe`;
          try {
            await tx.$executeRaw`UPDATE "user" SET timezone = timezone WHERE id = ${a.userId}::uuid`;
          } catch (err) {
            writeState = rawSqlState(err);
          }
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT probe`;
        },
      });
      await repo.snapshot(a.userId);
      expect(probe).toEqual({ iso: "repeatable read", ro: "on", who: a.userId });
      expect(writeState).toBe("25006");
    });
  });

  it("AC35 — a Hevy import batch of three workouts lands whole, every child row owned by the caller, past the catalog FOR SHARE", async () => {
    const importer = await insertUser(db);
    await seedPairs(db, importer, [{ hevyTemplateId: "T-BENCH", exerciseId: globalExercise }]);
    const day = (n: number) =>
      importWorkoutFixture({ startTime: `2026-09-0${n}T10:00:00Z`, endTime: `2026-09-0${n}T11:00:00Z` });

    const out = await appRepositories(db.app).hevyImportRepository.importBatch(
      importer,
      { dryRun: false, workouts: [day(1), day(2), day(3)] },
      new Date("2026-10-01T00:00:00Z"),
    );

    expect(out.results.map((r) => r.outcome)).toEqual(["create", "create", "create"]);
    const rows = await db.prisma.$queryRaw<{ workouts: bigint; exercises: bigint; sets: bigint; foreign_owner: bigint }[]>`
      SELECT (SELECT count(*) FROM "workout" WHERE user_id = ${importer}::uuid) AS workouts,
             (SELECT count(*) FROM "workout_exercise" WHERE user_id = ${importer}::uuid) AS exercises,
             (SELECT count(*) FROM "set_entry" WHERE user_id = ${importer}::uuid) AS sets,
             (SELECT count(*) FROM "set_entry" s JOIN "workout_exercise" we ON we.id = s.workout_exercise_id
                JOIN "workout" w ON w.id = we.workout_id
               WHERE w.user_id = ${importer}::uuid AND (s.user_id <> ${importer}::uuid OR we.user_id <> ${importer}::uuid)) AS foreign_owner`;
    expect(rows[0]).toEqual({ workouts: 3n, exercises: 3n, sets: 6n, foreign_owner: 0n });
  });

  describe("AC35 — provisioning", () => {
    const repo = () => appRepositories(db.app).userRepository;

    it("a new auth_sub creates exactly one user; the same sub again returns the same id", async () => {
      const sub = `auth0|new-${uuidv7()}`;
      const first = await repo().provision({ authSub: sub, email: "new@ex.com", emailVerified: true });
      expect(first.isNewUser).toBe(true);
      const second = await repo().provision({ authSub: sub, email: "new@ex.com", emailVerified: true });
      expect(second.isNewUser).toBe(false);
      expect(second.user.id).toBe(first.user.id);
      const rows = await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "user" WHERE auth_sub = ${sub}`;
      expect(rows[0]!.n).toBe(1n);
    });

    it("scoped to A's sub, B's sub reads no row", async () => {
      const [subA, subB] = [await subOf(a.userId), await subOf(b.userId)];
      const rows = await createScopedDb(db.app).forAuthSub(subA).$queryRaw<{ id: string }[]>`SELECT id::text FROM "user" WHERE auth_sub = ${subB}`;
      expect(rows).toEqual([]);
    });

    it("INSERT … ON CONFLICT DO NOTHING for an existing sub affects 0 rows and raises nothing", async () => {
      const sub = await subOf(a.userId);
      const n = await createScopedDb(db.app).forAuthSub(sub).$executeRaw`
        INSERT INTO "user" (id, auth_sub, email) VALUES (${uuidv7()}::uuid, ${sub}, 'x@ex.com') ON CONFLICT (auth_sub) DO NOTHING`;
      expect(n).toBe(0);
    });
  });

  describe("AC35 — no user set", () => {
    it("a raw statement on shared() reads no workout", async () => {
      const rows = await createScopedDb(db.app).shared().$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "workout"`;
      expect(rows[0]!.n).toBe(0n);
    });

    it("a repository read for a user that does not exist returns empty, null or not-found, never another user's data", async () => {
      const missing = uuidv7();
      const repos = appRepositories(db.app);
      await expect(repos.workoutRepository.getActiveWorkout(missing)).rejects.toBeInstanceOf(NotFoundError);
      await expect(repos.workoutRepository.getWorkoutById(missing, a.workoutId)).rejects.toBeInstanceOf(NotFoundError);
      expect((await repos.workoutRepository.listFinishedWorkouts(missing, { limit: 10 })).items).toEqual([]);
      expect(await repos.personalRecordRepository.list(missing, {})).toEqual([]);
      const routines = await repos.routineRepository.list(missing);
      expect(routines.routines).toEqual([]);
      expect(await repos.userRepository.findByAuthSub(`auth0|${missing}`)).toBeNull();
    });
  });

  describe("Review Focus 1 — a brand-new lifter's first sign-in, over HTTP", () => {
    it("a brand-new subject gets 200 from GET /v1/me", async () => {
      const token = `first-${uuidv7()}`;
      const res = await (await makeApp()).inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().isNewUser).toBe(true);
    });

    it("five concurrent first requests with one new subject all succeed, and exactly one user row exists", async () => {
      const token = `burst-${uuidv7()}`;
      const server = await makeApp();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => server.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })),
      );
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
      const rows = await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "user" WHERE auth_sub = ${`auth0|${token}`}`;
      expect(rows[0]!.n).toBe(1n);
    });
  });

  describe("Review Focus 2 — the rest of the sign-in path, over HTTP", () => {
    it("a token with a changed email updates the stored email", async () => {
      const token = `email-${uuidv7()}`;
      const emails = { [token]: "before@ex.com" };
      const server = await makeApp(emails);
      expect((await server.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode).toBe(200);
      emails[token] = "after@ex.com";
      const res = await server.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
      expect(res.statusCode, res.body).toBe(200);
      const stored = await db.prisma.$queryRaw<{ email: string }[]>`SELECT email FROM "user" WHERE auth_sub = ${`auth0|${token}`}`;
      expect(stored[0]!.email).toBe("after@ex.com");
    });

    it("PATCH /v1/me works", async () => {
      const token = `patch-${uuidv7()}`;
      const res = await (await makeApp()).inject({ method: "PATCH", url: "/v1/me", headers: bearer(token), payload: { displayName: "Lifter" } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().displayName).toBe("Lifter");
    });

    it("after DELETE /v1/account the next request gets 403 account-deleted", async () => {
      const token = `gone-${uuidv7()}`;
      const server = await makeApp();
      expect((await server.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode).toBe(200);
      expect((await server.inject({ method: "DELETE", url: "/v1/account", headers: bearer(token) })).statusCode).toBeLessThan(300);
      const res = await server.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().type).toMatch(/account-deleted$/);
    });
  });
});
