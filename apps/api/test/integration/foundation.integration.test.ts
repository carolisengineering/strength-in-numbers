import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

const BEARER = { authorization: "Bearer test-token" };
const JSON_HEADERS = { ...BEARER, "content-type": "application/json" };

describe.skipIf(!shouldRunIntegration())(
  "Foundation & Auth — integration (real Postgres)",
  () => {
    let db: IntegrationDb;

    beforeAll(async () => {
      db = await startIntegrationDb();
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    beforeEach(async () => {
      await db.prisma.user.deleteMany();
    });

    const appFor = (sub: string): Promise<FastifyInstance> =>
      buildApp({
        config: testConfig(),
        logger: false,
        checkReadiness: () => checkDatabaseReady(db.prisma),
        tokenVerifier: fakeVerifier(() =>
          authContext({ authSub: sub, email: `${sub}@ex.com` }),
        ),
        userRepository: createUserRepository(db.prisma),
        exerciseRepository: createExerciseRepository(db.prisma),
      });

    it("first GET /v1/me inserts exactly one row; isNewUser true then false (Criterion 7)", async () => {
      const app = await appFor("auth0|c7");

      const r1 = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().isNewUser).toBe(true);

      const r2 = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      expect(r2.json().isNewUser).toBe(false);

      expect(await db.prisma.user.count({ where: { authSub: "auth0|c7" } })).toBe(1);
    });

    it("two concurrent first requests → one row, no 500 (Criterion 8)", async () => {
      const app = await appFor("auth0|c8");

      const [a, b] = await Promise.all([
        app.inject({ method: "GET", url: "/v1/me", headers: BEARER }),
        app.inject({ method: "GET", url: "/v1/me", headers: BEARER }),
      ]);

      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(await db.prisma.user.count({ where: { authSub: "auth0|c8" } })).toBe(1);
      const flags = [a.json().isNewUser, b.json().isNewUser].sort();
      expect(flags).toEqual([false, true]);
    });

    it("soft-deleted user → 403 account-deleted (Criterion 9)", async () => {
      const app = await appFor("auth0|c9");
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      await db.prisma.user.updateMany({
        where: { authSub: "auth0|c9" },
        data: { deletedAt: new Date() },
      });

      const res = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      expect(res.statusCode).toBe(403);
      expect(res.json().type).toContain("account-deleted");
    });

    it("PATCH /v1/me updates the row and advances updated_at (Criterion 10)", async () => {
      const app = await appFor("auth0|c10");
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      const before = (await db.prisma.user.findFirstOrThrow({
        where: { authSub: "auth0|c10" },
      })).updatedAt;

      const res = await app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: JSON_HEADERS,
        payload: { displayName: "Carol", unitPreference: "lb", timezone: "America/Chicago" },
      });
      expect(res.statusCode).toBe(200);

      const after = await db.prisma.user.findFirstOrThrow({
        where: { authSub: "auth0|c10" },
      });
      expect(after.displayName).toBe("Carol");
      expect(after.unitPreference).toBe("lb");
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it("PATCH /v1/me rejects an unknown field with 422 + errors[] (Criterion 10)", async () => {
      const app = await appFor("auth0|c10b");
      await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: JSON_HEADERS,
        payload: { nope: 1 },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors.length).toBeGreaterThan(0);
    });

    it("/readyz reflects DB liveness (Criterion 4)", async () => {
      const app = await buildApp({
        config: testConfig(),
        logger: false,
        checkReadiness: () => checkDatabaseReady(db.prisma),
        readinessTtlMs: 0,
        tokenVerifier: fakeVerifier(() => authContext()),
        userRepository: createUserRepository(db.prisma),
        exerciseRepository: createExerciseRepository(db.prisma),
      });
      const up = await app.inject({ method: "GET", url: "/readyz" });
      expect(up.statusCode).toBe(200);
    });

    it("provision() reports isNewUser from the raw ON CONFLICT affected-row count", async () => {
      const repo = createUserRepository(db.prisma);
      const input = {
        authSub: "auth0|raw",
        email: "raw@ex.com",
        emailVerified: true,
      };
      const first = await repo.provision(input);
      const second = await repo.provision(input);
      expect(first.isNewUser).toBe(true);
      expect(second.isNewUser).toBe(false);
      expect(await db.prisma.user.count({ where: { authSub: "auth0|raw" } })).toBe(1);
    });
  },
);
