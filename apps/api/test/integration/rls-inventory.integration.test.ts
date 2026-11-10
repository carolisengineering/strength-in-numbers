// apps/api/test/integration/rls-inventory.integration.test.ts
// Spec 21.1 AC33 — every table needs RLS, a policy for sin_app and an allow-list entry, or CI fails.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { rlsInventoryProblems } from "./rls-inventory.js";

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC33 — the table inventory (real Postgres)", () => {
  let db: AppIntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("AC33 — the migrated schema is clean", async () => {
    expect(await rlsInventoryProblems(db.prisma)).toEqual([]);
  });

  it("AC33 — a new table without RLS, policy and grant entry fails, one line per gap", async () => {
    const ofProbe = async () => (await rlsInventoryProblems(db.prisma)).filter((p) => p.includes(`"inventory_probe"`)).sort();
    try {
      await db.prisma.$executeRawUnsafe(`CREATE TABLE public.inventory_probe (id uuid)`);
      expect(await ofProbe()).toEqual([
        `table "inventory_probe": RLS not enabled`,
        `table "inventory_probe": no entry in APP_GRANTS`,
        `table "inventory_probe": no policy for sin_app`,
        `table "inventory_probe": not in RLS_TABLES`,
      ]);

      await db.prisma.$executeRawUnsafe(`ALTER TABLE public.inventory_probe ENABLE ROW LEVEL SECURITY`);
      expect(await ofProbe()).toEqual([
        `table "inventory_probe": no entry in APP_GRANTS`,
        `table "inventory_probe": no policy for sin_app`,
        `table "inventory_probe": not in RLS_TABLES`,
      ]);

      await db.prisma.$executeRawUnsafe(`CREATE POLICY inventory_probe_own ON public.inventory_probe TO sin_app USING (true)`);
      expect(await ofProbe()).toEqual([`table "inventory_probe": no entry in APP_GRANTS`, `table "inventory_probe": not in RLS_TABLES`]);
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public.inventory_probe`);
    }
    expect(await rlsInventoryProblems(db.prisma)).toEqual([]);
  });

  it("AC33 — a table with a user_id column must be on the AC34 probe's list, so a USING (true) policy can't pass unprobed", async () => {
    const ofProbe = async () => (await rlsInventoryProblems(db.prisma)).filter((p) => p.includes(`"inventory_owned"`));
    try {
      await db.prisma.$executeRawUnsafe(`CREATE TABLE public.inventory_owned (id uuid, user_id uuid)`);
      await db.prisma.$executeRawUnsafe(`ALTER TABLE public.inventory_owned ENABLE ROW LEVEL SECURITY`);
      await db.prisma.$executeRawUnsafe(`CREATE POLICY inventory_owned_any ON public.inventory_owned TO sin_app USING (true)`);
      expect(await ofProbe()).toContain(`table "inventory_owned": has a user_id column but is not in OWNED_TABLES, so the AC34 probe skips it`);
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public.inventory_owned`);
    }
  });

  it("AC33 — a policy for another role does not count as a policy for sin_app", async () => {
    await db.prisma.$executeRawUnsafe(`DROP POLICY muscle_group_read ON "muscle_group"`);
    try {
      await db.prisma.$executeRawUnsafe(`CREATE POLICY muscle_group_read ON "muscle_group" FOR SELECT TO PUBLIC USING (true)`);
      expect(await rlsInventoryProblems(db.prisma)).toEqual([`table "muscle_group": no policy for sin_app`]);
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS muscle_group_read ON "muscle_group"`);
      await db.prisma.$executeRawUnsafe(`CREATE POLICY muscle_group_read ON "muscle_group" FOR SELECT TO sin_app USING (true)`);
    }
  });

  it("AC33 — a grant beyond the allow-list fails, and a table switched off fails", async () => {
    await db.prisma.$executeRawUnsafe(`GRANT DELETE ON "equipment" TO sin_app`);
    try {
      expect(await rlsInventoryProblems(db.prisma)).toEqual([`table "equipment": sin_app's grants differ from APP_GRANTS`]);
    } finally {
      await db.prisma.$executeRawUnsafe(`REVOKE DELETE ON "equipment" FROM sin_app`);
    }
    await db.prisma.$executeRawUnsafe(`ALTER TABLE "routine" DISABLE ROW LEVEL SECURITY`);
    try {
      expect(await rlsInventoryProblems(db.prisma)).toEqual([`table "routine": RLS not enabled`]);
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE "routine" ENABLE ROW LEVEL SECURITY`);
    }
    expect(await rlsInventoryProblems(db.prisma)).toEqual([]);
  });
});
