import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { AccountDeletedResponseSchema } from "@sin/core";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, logWorkout } from "./records-helpers.js";
import { bearer, makeAccountApp, tableHash, TRUNCATE_ACCOUNTS, USER_TABLES } from "./account-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 11 — DELETE /v1/account (real Postgres)", () => {
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
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ACCOUNTS);
  });

  async function userIdOf(token: string): Promise<string> {
    const res = await app!.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
    return res.json().id as string;
  }

  it("AC14 — 202 body matches the stored deleted_at; purgeEligibleAt is +30 d exactly", async () => {
    app = await makeAccountApp(db);
    const id = await userIdOf("del-a");
    const res = await app.inject({ method: "DELETE", url: "/v1/account", headers: bearer("del-a") });
    expect(res.statusCode).toBe(202);
    const body = AccountDeletedResponseSchema.parse(res.json());
    const [row] = await db.prisma.$queryRawUnsafe<{ deleted_at: Date }[]>(
      `SELECT deleted_at FROM "user" WHERE id = $1::uuid`, id);
    expect(body.deletedAt).toBe(row!.deleted_at.toISOString());
    expect(Date.parse(body.purgeEligibleAt) - Date.parse(body.deletedAt)).toBe(30 * 86_400_000);
  });

  it("AC15 — only the caller's deleted_at changes; every table of every user is otherwise identical", async () => {
    app = await makeAccountApp(db);
    const a = await userIdOf("del-a");
    const b = await userIdOf("del-b");
    for (const u of [a, b]) {
      const ex = await insertExercise(db, { ownerUserId: u });
      await logWorkout(db, u, { startedAt: new Date(Date.now() - 86_400_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 100 }] }] });
      await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 100 }] }] });
    }
    const before = Object.fromEntries(await Promise.all(USER_TABLES.map(async (t) =>
      [t, await tableHash(db, t, t === "user" ? ["deleted_at"] : [])] as const)));
    expect((await app.inject({ method: "DELETE", url: "/v1/account", headers: bearer("del-a") })).statusCode).toBe(202);
    for (const t of USER_TABLES) {
      expect(await tableHash(db, t, t === "user" ? ["deleted_at"] : [])).toBe(before[t]);
    }
    const flags = await db.prisma.$queryRawUnsafe<{ id: string; deleted: boolean }[]>(
      `SELECT id::text, deleted_at IS NOT NULL AS deleted FROM "user" ORDER BY id`);
    expect(flags).toEqual([{ id: a, deleted: true }, { id: b, deleted: false }].sort((x, y) => x.id.localeCompare(y.id)));
  });

  it("AC16 — every device is locked out at once; other users are not", async () => {
    app = await makeAccountApp(db, { alias: { "del-a-phone": "auth0|del-a" } });
    await userIdOf("del-a");
    await userIdOf("del-c");
    await app.inject({ method: "DELETE", url: "/v1/account", headers: bearer("del-a") });
    for (const [token, method, url] of [
      ["del-a", "GET", "/v1/me"],
      ["del-a", "GET", "/v1/workouts/active"],
      ["del-a", "DELETE", "/v1/account"],
      ["del-a", "GET", "/v1/account/export"],
      ["del-a-phone", "GET", "/v1/me"],
    ] as const) {
      const res = await app.inject({ method, url, headers: bearer(token) });
      expect(res.statusCode, `${token} ${method} ${url}`).toBe(403);
      expect(res.json().type).toMatch(/account-deleted$/);
    }
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: bearer("del-c") })).statusCode).toBe(200);
  });

  it("AC17 — two concurrent first deletes: exactly one 202 and one 403, never a 500 (×20)", async () => {
    app = await makeAccountApp(db);
    for (let i = 0; i < 20; i++) {
      const token = `race-${uuidv7()}`;
      await userIdOf(token);
      const results = await Promise.all([
        app.inject({ method: "DELETE", url: "/v1/account", headers: bearer(token) }),
        app.inject({ method: "DELETE", url: "/v1/account", headers: bearer(token) }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([202, 403]);
    }
  });
});
