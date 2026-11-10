// apps/api/test/integration/rls-probe.integration.test.ts
// Spec 21.1 AC34 — layer 3 on its own: statements with no WHERE at all, as sin_app with RLS on, touch only the set user's rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { quoteIdent } from "../../src/db/rls-tables.js";
import { rawSqlState } from "../../src/repositories/pg-errors.js";
import { OWNED_TABLES } from "./app-grants.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { seedEveryTable, type SeededUser } from "./rls-seed.js";

/** Thrown to roll a probe's transaction back. */
class RollBack extends Error {}

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC34 — unfiltered statements as sin_app (real Postgres)", () => {
  let db: AppIntegrationDb;
  let a: SeededUser;
  let b: SeededUser;
  let globalExercise: string;

  /** On `sin_app`, in one transaction, with `app.user_id` in the given state (`null` = never set). */
  const asApp = <T>(who: string | null, run: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.app.$transaction(async (tx) => {
      if (who !== null) await tx.$queryRaw`SELECT set_config('app.user_id', ${who}, true)`;
      return run(tx);
    });

  /** The row count a statement reports, in a transaction that is then rolled back. */
  const rolledBack = async (who: string, sql: string): Promise<number> => {
    let n = -1;
    await asApp(who, async (tx) => {
      n = await tx.$executeRawUnsafe(sql);
      throw new RollBack();
    }).catch((err: unknown) => {
      if (!(err instanceof RollBack)) throw err;
    });
    return n;
  };

  const ownedCount = async (table: string, user: string) =>
    Number(
      (await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quoteIdent(table)} WHERE user_id = $1::uuid`, user))[0]!.n,
    );

  const countAs = async (who: string | null, table: string) =>
    asApp(who, async (tx) => Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quoteIdent(table)}`))[0]!.n));

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    a = await seedEveryTable(db, await insertUser(db));
    b = await seedEveryTable(db, await insertUser(db));
    globalExercise = await insertExercise(db);
    await db.prisma.$executeRawUnsafe(`INSERT INTO "muscle_group" (id, name) VALUES ('probe_muscle', 'Probe muscle')`);
    await db.prisma.$executeRawUnsafe(`INSERT INTO "equipment" (id, name) VALUES ('probe_equipment', 'Probe equipment')`);
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("AC34 — the seed covers all 15 owned tables for both users, so coverage cannot silently shrink", async () => {
    expect(OWNED_TABLES).toHaveLength(15);
    for (const table of OWNED_TABLES) {
      expect([table, await ownedCount(table, a.userId) > 0, await ownedCount(table, b.userId) > 0]).toEqual([table, true, true]);
    }
  });

  for (const table of OWNED_TABLES) {
    it(`AC34 — ${table}: SELECT, UPDATE and DELETE with no WHERE reach only the set user's rows`, async () => {
      for (const who of [a.userId, b.userId]) {
        const other = who === a.userId ? b.userId : a.userId;
        const mine = await ownedCount(table, who);
        const theirs = await ownedCount(table, other);

        expect(await countAs(who, table)).toBe(mine);
        const seenOwners = await asApp(who, (tx) =>
          tx.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id::text FROM ${quoteIdent(table)}`),
        );
        expect(seenOwners.map((r) => r.user_id)).toEqual([who]);

        expect(await rolledBack(who, `UPDATE ${quoteIdent(table)} SET user_id = user_id`)).toBe(mine);
        expect(await rolledBack(who, `DELETE FROM ${quoteIdent(table)}`)).toBe(mine);

        // Rolled back, and the other user's rows were never in reach.
        expect(await ownedCount(table, who)).toBe(mine);
        expect(await ownedCount(table, other)).toBe(theirs);
      }
    });
  }

  it("AC34 — a committed DELETE with no WHERE removes only the set user's rows", async () => {
    const victim = await seedEveryTable(db, await insertUser(db));
    const before = await ownedCount("routine_item_set", a.userId);
    await asApp(victim.userId, (tx) => tx.$executeRawUnsafe(`DELETE FROM "routine_item_set"`));
    expect(await ownedCount("routine_item_set", victim.userId)).toBe(0);
    expect(await ownedCount("routine_item_set", a.userId)).toBe(before);
  });

  it("AC34 — user: SELECT with no WHERE returns only the set user, and a blind UPDATE affects one row", async () => {
    const rows = await asApp(a.userId, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "user"`);
    expect(rows.map((r) => r.id)).toEqual([a.userId]);
    expect(await rolledBack(a.userId, `UPDATE "user" SET updated_at = updated_at`)).toBe(1);
  });

  it("AC34 — exercise: SELECT with no WHERE returns the global rows and the caller's own, never another user's", async () => {
    const rows = await asApp(a.userId, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "exercise"`);
    expect(rows.map((r) => r.id).sort()).toEqual([a.customExercise, globalExercise].sort());
  });

  it("AC34 — exercise: a blind UPDATE that reaches a global row is refused whole (WITH CHECK), so nothing changes", async () => {
    let state: string | null = null;
    try {
      await asApp(a.userId, (tx) => tx.$executeRawUnsafe(`UPDATE "exercise" SET name = 'Overwritten'`));
    } catch (err) {
      state = rawSqlState(err);
    }
    expect(state).toBe("42501");
    const names = await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "exercise" WHERE name = 'Overwritten'`;
    expect(names[0]!.n).toBe(0n);
  });

  it("AC34 — exercise: an UPDATE that skips the global rows affects only the caller's custom row, never another user's", async () => {
    expect(await rolledBack(a.userId, `UPDATE "exercise" SET updated_at = updated_at WHERE owner_user_id IS NOT NULL`)).toBe(1);
  });

  it("AC34 — no user set: every owned table counts 0; global exercises and the reference tables stay visible", async () => {
    for (const table of OWNED_TABLES) expect([table, await countAs(null, table)]).toEqual([table, 0]);
    expect(await countAs(null, "user")).toBe(0);
    const exercises = await asApp(null, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "exercise"`);
    expect(exercises.map((r) => r.id)).toEqual([globalExercise]);
    expect(await countAs(null, "muscle_group")).toBeGreaterThan(0);
    expect(await countAs(null, "equipment")).toBeGreaterThan(0);
  });
});
