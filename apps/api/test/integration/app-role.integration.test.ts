// apps/api/test/integration/app-role.integration.test.ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/db/app-role-cli.js";
import { shouldRunIntegration, startIntegrationDb, TEST_APP_PASSWORD, type AppIntegrationDb } from "./helpers.js";

/**
 * Spec 21.1 AC29 — `db:app-role` gives `sin_app` its login and password, prints the role's flags and memberships, never
 * prints the password, and is idempotent. AC30 — `startIntegrationDb()` exposes `db.app` on `sin_app`.
 * Review Focus 1 (Postgres 16's creator grant) and 3 (a password with quotes, `$$` and backslashes).
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC29 — db:app-role (real Postgres)", () => {
  let db: AppIntegrationDb;

  /** The container's superuser URL with TLS off (Testcontainers Postgres has none; resolveDatabaseUrl keeps it). */
  const ownerUrl = () => `${db.url}${db.url.includes("?") ? "&" : "?"}sslmode=disable`;
  const loginUrl = (password: string) => {
    const u = new URL(ownerUrl());
    u.username = "sin_app";
    u.password = password;
    return u.toString();
  };
  async function currentUserWith(password: string): Promise<string> {
    const client = new PrismaClient({ datasourceUrl: loginUrl(password) });
    try {
      return (await client.$queryRaw<{ u: string }[]>`SELECT current_user AS u`)[0]!.u;
    } finally {
      await client.$disconnect();
    }
  }
  async function run(env: NodeJS.ProcessEnv): Promise<{ code: number; out: string; err: string }> {
    let out = "";
    let err = "";
    const code = await main([], env, {
      io: { prompt: () => Promise.reject(new Error("no prompt in tests")), out: (s) => void (out += s), err: (s) => void (err += s), isTTY: false },
    });
    return { code, out, err };
  }

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("AC30 — startIntegrationDb exposes db.app, a client on sin_app", async () => {
    expect((await db.app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`)[0]!.u).toBe("sin_app");
    expect(new URL(db.appUrl).username).toBe("sin_app");
    expect(decodeURIComponent(new URL(db.appUrl).password)).toBe(TEST_APP_PASSWORD);
  });

  it("AC29 — gives sin_app a working login and prints a clean report", async () => {
    const r = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: "first-password-123" });
    expect(r.code, r.err).toBe(0);
    expect(await currentUserWith("first-password-123")).toBe("sin_app");
    expect(r.out).toMatch(/sin_app: login yes, superuser no, bypassrls no, createrole no, createdb no/);
    expect(r.out).toMatch(/memberOf: none/);
  });

  it("AC29 — idempotent: a second run gives the same report, and a changed password takes effect", async () => {
    const first = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: "first-password-123" });
    const second = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: "second-password-456" });
    expect([first.code, second.code]).toEqual([0, 0]);
    expect(second.out).toBe(first.out);
    expect(await currentUserWith("second-password-456")).toBe("sin_app");
    await expect(currentUserWith("first-password-123")).rejects.toThrow();
  });

  it("AC29 — a membership makes the report unclean (exit 1, the role named)", async () => {
    await db.prisma.$executeRawUnsafe(`GRANT pg_read_all_data TO sin_app`);
    try {
      const r = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: "second-password-456" });
      expect(r.code).toBe(1);
      expect(r.out + r.err).toContain("pg_read_all_data");
    } finally {
      await db.prisma.$executeRawUnsafe(`REVOKE pg_read_all_data FROM sin_app`);
    }
  });

  it("Review Focus 1 — an owner holding sin_app WITH ADMIN OPTION (Postgres 16's creator grant) is not a membership of sin_app", async () => {
    await db.prisma.$executeRawUnsafe(`CREATE ROLE owner_like CREATEROLE`);
    await db.prisma.$executeRawUnsafe(`GRANT sin_app TO owner_like WITH ADMIN OPTION`);
    const r = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: "second-password-456" });
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/memberOf: none/);
  });

  it("Review Focus 3 — a password with quotes, $$ and backslashes is set exactly and never printed, even on a failing run", async () => {
    const password = `it's "a" $$x$$ \\ pass`;
    const ok = await run({ OWNER_DATABASE_URL: ownerUrl(), APP_ROLE_PASSWORD: password });
    expect(ok.code, ok.err).toBe(0);
    expect(await currentUserWith(password)).toBe("sin_app");
    expect(ok.out + ok.err).not.toContain(password);

    const wrong = new URL(ownerUrl());
    wrong.port = "1";
    const bad = await run({ OWNER_DATABASE_URL: wrong.toString(), APP_ROLE_PASSWORD: password });
    expect(bad.code).toBe(1);
    expect(bad.out + bad.err).not.toContain(password);
    expect(bad.out + bad.err).not.toContain(new URL(ownerUrl()).password);
  });
});
