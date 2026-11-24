import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppIntegrationDb, EXPECT_SHARED_PG_ENV, SHARED_PG_ENV, insertUser, shouldRunIntegration, startIntegrationDb, startPrivateIntegrationDb } from "./helpers.js";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
const migrationCount = readdirSync(migrationsDir).filter((name) => statSync(`${migrationsDir}${name}`).isDirectory()).length;
const where = (url: string) => {
  const u = new URL(url);
  return { server: `${u.hostname}:${u.port}`, database: u.pathname.slice(1) };
};

/** The integration config promises a shared server; the default config (`pnpm test`) has none, and every file is private. */
const expectsShared = process.env[EXPECT_SHARED_PG_ENV] === "1";
const hasShared = process.env[SHARED_PG_ENV] !== undefined;

describe.skipIf(!shouldRunIntegration() || !expectsShared)("issue 361 — the integration config's shared server", () => {
  it("reaches this worker, so no file falls back to a private container unnoticed", () => {
    expect(process.env[SHARED_PG_ENV]).toMatch(/^postgres(?:ql)?:\/\//);
  });
});

describe.skipIf(!shouldRunIntegration() || !hasShared)("issue 361 — a database per file on the shared server", () => {
  let a: AppIntegrationDb;
  let b: AppIntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration() || !hasShared) return;
    a = await startIntegrationDb();
    b = await startIntegrationDb();
  });
  afterAll(async () => {
    await Promise.allSettled([a?.stop(), b?.stop()]);
  });

  it("two calls give two databases on one server", () => {
    expect(where(a.url).server).toBe(where(b.url).server);
    expect(where(a.url).database).not.toBe(where(b.url).database);
    expect(where(a.url).database).toMatch(/^sin_it_[0-9a-f]{12}$/);
  });

  it("a row written in one is absent from the other", async () => {
    const id = await insertUser(a);
    expect(await a.prisma.user.count({ where: { id } })).toBe(1);
    expect(await b.prisma.user.count({ where: { id } })).toBe(0);
  });

  it("each holds every migration", async () => {
    for (const db of [a, b]) {
      const [row] = await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
      expect(Number(row!.n)).toBe(migrationCount);
    }
  });

  it("app is the restricted login, and row-level security hides a row it has no user setting for", async () => {
    const id = await insertUser(a);
    const [who] = await a.app.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(who!.current_user).toBe("sin_app");
    const rows = await a.app.$queryRaw<{ id: string }[]>`SELECT id FROM "user" WHERE id = ${id}::uuid`;
    expect(rows).toEqual([]);
  });

  it("stop() drops the database", async () => {
    const c = await startIntegrationDb();
    const name = where(c.url).database;
    await c.stop();
    const left = await a.prisma.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname = ${name}`;
    expect(left).toEqual([]);
  });

  it("a private database is its own server, named sin_test", async () => {
    const p = await startPrivateIntegrationDb();
    try {
      expect(where(p.url).server).not.toBe(where(a.url).server);
      expect(where(p.url).database).toBe("sin_test");
    } finally {
      await p.stop();
    }
    // A container start plus every migration, inside the test body: the hooks elsewhere allow the same.
  }, 180_000);
});
