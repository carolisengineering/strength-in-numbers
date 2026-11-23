// apps/api/test/integration/enable-rls-migration.integration.test.ts
// Spec 21.1 Phase D, AC32 — migration 0021 (row-level security on all 19 tables), real Postgres.
// The whole-schema `prisma migrate diff` no-drift check moved to reps-at-weight-migration with 0022 (apps/api CLAUDE.md).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RLS_TABLES } from "../../src/db/rls-tables.js";
import { shouldRunIntegration, startMigratedDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("21.1 AC36 — the integration suite runs with row-level security on: Spec 21.1 Phase D, migration 0021 (real Postgres)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startMigratedDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("AC32 — all 19 tables have RLS enabled and not forced; _prisma_migrations has neither", async () => {
    const rows = await db.prisma.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`;
    expect(rows.map((r) => r.relname).sort()).toEqual([...RLS_TABLES, "_prisma_migrations"].sort());
    expect(RLS_TABLES).toHaveLength(19);
    for (const r of rows) {
      const expected = r.relname === "_prisma_migrations" ? [false, false] : [true, false];
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, ...expected]);
    }
  });

  it("AC32 — the first statements take every lock up front, in the API's write order, with a lock timeout", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../prisma/migrations/0021_enable_row_level_security/migration.sql", import.meta.url)), "utf8");
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
    expect([...order].sort()).toEqual([...RLS_TABLES].sort());
    expect(order.indexOf("routine")).toBeLessThan(order.indexOf("workout"));
    expect(order.indexOf("workout")).toBeLessThan(order.indexOf("workout_exercise"));
    expect(order.indexOf("workout_exercise")).toBeLessThan(order.indexOf("set_entry"));
    expect(order.indexOf("routine")).toBeLessThan(order.indexOf("routine_item"));
    // Exactly one switch per table and nothing else: no FORCE (D6), no DISABLE (D12).
    expect(statements.slice(2)).toEqual(RLS_TABLES.map((t) => `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`));
  });
});
