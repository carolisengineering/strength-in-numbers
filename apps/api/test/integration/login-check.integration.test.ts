// apps/api/test/integration/login-check.integration.test.ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLoginCannotBypassRls, DatabaseLoginRejectedError, UnsafeDatabaseLoginError } from "../../src/db/login-check.js";
import { shouldRunIntegration, startIntegrationDb, startMigratedDb, TEST_APP_PASSWORD, type AppIntegrationDb, type IntegrationDb } from "./helpers.js";

/** Spec 21.1 AC24 — the boot check against real roles: the four unsafe cases, row_security off, and a clean sin_app. */
describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC24 — the boot check on real roles", () => {
  let db: AppIntegrationDb;
  const PASSWORD = "t_role_password";
  const opened: PrismaClient[] = [];

  const loginAs = (role: string, password = PASSWORD): PrismaClient => {
    const u = new URL(db.url);
    u.username = role;
    u.password = password;
    const client = new PrismaClient({ datasourceUrl: u.toString() });
    opened.push(client);
    return client;
  };
  const verdict = async (client: PrismaClient) => {
    const err = await assertLoginCannotBypassRls(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsafeDatabaseLoginError);
    const e = err as UnsafeDatabaseLoginError;
    expect(e.message).not.toContain(PASSWORD);
    expect(e.message).not.toContain(new URL(db.url).host);
    return e.reason;
  };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    for (const sql of [
      `CREATE ROLE t_bypass LOGIN PASSWORD '${PASSWORD}' BYPASSRLS`,
      `CREATE ROLE t_owner LOGIN PASSWORD '${PASSWORD}'`,
      `CREATE ROLE t_member LOGIN PASSWORD '${PASSWORD}'`,
      `GRANT t_bypass TO t_member`,
      `CREATE ROLE t_rowsec LOGIN PASSWORD '${PASSWORD}'`,
      `ALTER ROLE t_rowsec SET row_security = off`,
      `CREATE ROLE t_admin`,
      `GRANT sin_app TO t_admin WITH ADMIN OPTION`,
    ]) {
      await db.prisma.$executeRawUnsafe(sql);
    }
  }, 180_000);

  afterAll(async () => {
    await Promise.all(opened.map((c) => c.$disconnect()));
    await db?.stop();
  });

  it("the container's superuser → superuser", async () => {
    expect(await verdict(db.prisma)).toBe("superuser");
  });

  it("a BYPASSRLS login → has BYPASSRLS", async () => {
    expect(await verdict(loginAs("t_bypass"))).toBe("has BYPASSRLS");
  });

  it("a login that owns a table → owns application tables", async () => {
    await db.prisma.$executeRawUnsafe(`ALTER TABLE "routine_section" OWNER TO t_owner`);
    try {
      expect(await verdict(loginAs("t_owner"))).toBe("owns application tables");
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE "routine_section" OWNER TO "${new URL(db.url).username}"`);
    }
  });

  it("a login that can SET ROLE into a BYPASSRLS role → can SET ROLE to it", async () => {
    expect(await verdict(loginAs("t_member"))).toBe('can SET ROLE to "t_bypass"');
  });

  it("a login with row_security = off → row_security is off", async () => {
    expect(await verdict(loginAs("t_rowsec"))).toBe("row_security is off");
  });

  it("sin_app is clean, and Postgres 16's creator grant (another role holding sin_app WITH ADMIN) does not change that (Review Focus 1)", async () => {
    await expect(assertLoginCannotBypassRls(db.app)).resolves.toMatchObject({
      role: "sin_app",
      superuser: false,
      bypassrls: false,
      ownsTables: false,
      memberOfBypass: [],
      rowSecurity: true,
    });
  });

  describe("Review Focus 4 — sin_app before db:app-role", () => {
    let fresh: IntegrationDb;
    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      fresh = await startMigratedDb();
    }, 180_000);
    afterAll(async () => {
      await fresh?.stop();
    });

    it("still NOLOGIN: DatabaseLoginRejectedError in under 2 s, naming db:app-role (no 20 s retry)", async () => {
      const u = new URL(fresh.url);
      u.username = "sin_app";
      u.password = TEST_APP_PASSWORD;
      const client = new PrismaClient({ datasourceUrl: u.toString() });
      opened.push(client);
      const started = Date.now();
      const err = await assertLoginCannotBypassRls(client).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DatabaseLoginRejectedError);
      expect((err as Error).message).toContain("pnpm --filter @sin/api run db:app-role");
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("a login with the wrong password is rejected the same way", async () => {
      await fresh.prisma.$executeRawUnsafe(`ALTER ROLE sin_app WITH LOGIN PASSWORD 'the-right-password'`);
      const u = new URL(fresh.url);
      u.username = "sin_app";
      u.password = "the-wrong-password";
      const client = new PrismaClient({ datasourceUrl: u.toString() });
      opened.push(client);
      await expect(assertLoginCannotBypassRls(client)).rejects.toBeInstanceOf(DatabaseLoginRejectedError);
    });
  });
});
