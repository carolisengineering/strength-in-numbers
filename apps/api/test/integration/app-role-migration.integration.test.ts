// apps/api/test/integration/app-role-migration.integration.test.ts
// Spec 21.1 Phase C, AC23 — migration 0020 (role sin_app, grants, inert policies), real Postgres.
// Owns the whole-schema `prisma migrate diff` no-drift check (moved here from child-table-owner-migration, apps/api CLAUDE.md).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shouldRunIntegration, startMigratedDb, type IntegrationDb } from "./helpers.js";

const OWNED_TABLES = [
  "workout",
  "routine",
  "personal_record",
  "hevy_exercise_pair",
  "hevy_section_rule",
  "hevy_link",
  "hevy_account",
  "workout_exercise",
  "workout_section",
  "set_entry",
  "workout_planned_set",
  "workout_section_round",
  "routine_item",
  "routine_section",
  "routine_item_set",
] as const;
const ALL_TABLES = [...OWNED_TABLES, "user", "exercise", "muscle_group", "equipment"];
const POLICY_NAMES = [
  ...OWNED_TABLES.map((t) => `${t}_own`),
  "user_select",
  "user_insert",
  "user_update",
  "exercise_select",
  "exercise_insert",
  "exercise_update",
  "muscle_group_read",
  "equipment_read",
].sort();

interface RoleFlags {
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
}

const withDatabase = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

describe.skipIf(!shouldRunIntegration())("Spec 21.1 Phase C — migration 0020 (real Postgres)", () => {
  let db: IntegrationDb;

  const roleFlags = async () =>
    (
      await db.prisma.$queryRaw<RoleFlags[]>`
        SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'sin_app'`
    )[0];

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startMigratedDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("AC23 — creates sin_app with no privileges beyond its grants", async () => {
    expect(await roleFlags()).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it("AC23 — 23 policies, all TO sin_app, none active (RLS is off on all 19 tables)", async () => {
    const policies = await db.prisma.$queryRaw<{ policyname: string; roles: string[] }[]>`
      SELECT policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' ORDER BY policyname`;
    expect(policies.map((p) => p.policyname)).toEqual(POLICY_NAMES);
    expect(policies.every((p) => p.roles.length === 1 && p.roles[0] === "sin_app")).toBe(true);
    const rls = await db.prisma.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY(${ALL_TABLES}::text[])`;
    expect(rls.map((r) => r.relname).sort()).toEqual([...ALL_TABLES].sort());
    expect(rls.filter((r) => r.relrowsecurity || r.relforcerowsecurity)).toEqual([]);
  });

  it("AC23 — the owned tables' policies are FOR ALL with the same USING and WITH CHECK", async () => {
    const own = await db.prisma.$queryRaw<{ tablename: string; cmd: string; qual: string; with_check: string }[]>`
      SELECT tablename, cmd, qual, with_check FROM pg_policies WHERE policyname LIKE '%\_own'`;
    expect(own).toHaveLength(OWNED_TABLES.length);
    for (const p of own) {
      expect(p.cmd).toBe("ALL");
      expect(p.qual).toMatch(/^\(user_id = \( SELECT app_user_id\(\) AS app_user_id\)\)$/);
      expect(p.with_check).toBe(p.qual);
    }
  });

  it("AC23 — applies cleanly where the role already exists, and keeps a login given since", async () => {
    await db.prisma.$executeRawUnsafe(`ALTER ROLE sin_app WITH LOGIN`);
    await db.prisma.$executeRawUnsafe(`CREATE DATABASE second`);
    const second = withDatabase(db.url, "second");
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: second },
      stdio: "pipe",
    });
    expect(await roleFlags()).toEqual({ rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    const { PrismaClient } = await import("@prisma/client");
    const other = new PrismaClient({ datasourceUrl: second });
    try {
      const names = await other.$queryRaw<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY policyname`;
      expect(names.map((n) => n.policyname)).toEqual(POLICY_NAMES);
    } finally {
      await other.$disconnect();
      await db.prisma.$executeRawUnsafe(`ALTER ROLE sin_app WITH NOLOGIN`);
    }
  });

  it("AC23 — the setting functions fail closed: unset and '' are NULL, a non-uuid raises 22P02", async () => {
    const read = (value: string | null) =>
      db.prisma.$transaction(async (tx) => {
        if (value !== null) await tx.$queryRaw`SELECT set_config('app.user_id', ${value}, true)`;
        return (await tx.$queryRaw<{ id: string | null }[]>`SELECT app_user_id()::text AS id`)[0]!.id;
      });
    expect(await read(null)).toBeNull();
    expect(await read("")).toBeNull();
    await expect(read("abc")).rejects.toMatchObject({ meta: { code: "22P02" } });
    const sub = await db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.auth_sub', '', true)`;
      return (await tx.$queryRaw<{ s: string | null }[]>`SELECT app_auth_sub() AS s`)[0]!.s;
    });
    expect(sub).toBeNull();
  });

  it("final review M3 — the first statements take every lock up front, in the API's write order, with a lock timeout", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../prisma/migrations/0020_app_role_and_policies/migration.sql", import.meta.url)), "utf8");
    const statements = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s !== "");
    expect(statements[0]).toBe("SET lock_timeout = '5s'");
    expect(statements[1]).toMatch(/^LOCK TABLE .* IN ACCESS EXCLUSIVE MODE$/);
    const order = [...statements[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect([...order].sort()).toEqual([...ALL_TABLES].sort());
    expect(order.indexOf("routine")).toBeLessThan(order.indexOf("workout"));
    expect(order.indexOf("workout")).toBeLessThan(order.indexOf("workout_exercise"));
    expect(order.indexOf("workout_exercise")).toBeLessThan(order.indexOf("set_entry"));
    expect(order.indexOf("routine")).toBeLessThan(order.indexOf("routine_item"));
  });

  // Moved from child-table-owner-migration (Spec 21.1 Phase A AC5/AC6): the whole-schema no-drift check lives in the
  // newest migration's test.
  describe("AC5, AC6 — schema.prisma matches the migrated schema", () => {
    it("prisma migrate diff reports only the generated set_entry columns: the composite owner keys are in schema.prisma too", () => {
      const apiDir = fileURLToPath(new URL("../../", import.meta.url));
      const r = spawnSync(
        "pnpm",
        ["exec", "prisma", "migrate", "diff", "--from-url", db.url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
        { cwd: apiDir, encoding: "utf8" },
      );
      const report = `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
      expect(r.status, report).toBe(2);
      const changeLines = r.stdout.split("\n").map((l) => l.trim()).filter((l) => /^\[[*+-]\]/.test(l));
      // schema.prisma declares each parent link as the composite owner relation 0019 created, so the only difference
      // left is the long-standing one: the two generated set_entry columns (Specs 05.1, 05.3). 0020's role, grants,
      // functions and policies are outside Prisma's model.
      const expected = [
        "[*] Changed the `set_entry` table",
        expect.stringMatching(/^\[\*\] Altered column `weight_kg` \(default changed from `Some\(DbGenerated/),
        expect.stringMatching(/^\[\*\] Altered column `distance_m` \(default changed from `Some\(DbGenerated/),
      ];
      expect(changeLines, report).toEqual(expected);
    });
  });
});
