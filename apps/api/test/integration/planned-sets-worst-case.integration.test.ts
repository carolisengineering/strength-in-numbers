import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";

/** Measured locally at implementation (68 ms), ×5, floored at 1 s (spec AC27). */
const LIST_BOUND_MS = 1_000;

describe.skipIf(!shouldRunIntegration())("AC27 — 50 routines × 30 items × 20 rows read in one statement", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("returns 30 000 rows from a single statement (plus the 09.3 sweep probe) within the bound", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    await db.prisma.$executeRawUnsafe(`INSERT INTO "routine" (id, user_id, name) SELECT gen_random_uuid(), $1::uuid, 'R' || g FROM generate_series(1, 50) g`, u);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, target_sets, target_reps_low, target_reps_high)
       SELECT gen_random_uuid(), r.id, p, $2::uuid, 20, 5, 5 FROM "routine" r, generate_series(0, 29) p WHERE r.user_id = $1::uuid`, u, ex);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item_set" (id, routine_item_id, position, set_type, reps_low, reps_high, weight, weight_unit)
       SELECT gen_random_uuid(), ri.id, s, 'working', 5, 5, 100, 'kg' FROM "routine_item" ri, generate_series(0, 19) s`);
    const seen: string[] = [];
    (db.prisma as unknown as { $on: (e: "query", cb: (x: { query: string }) => void) => void }).$on("query", (e) => seen.push(e.query));
    seen.length = 0;
    const t0 = Date.now();
    const list = await createRoutineRepository(db.prisma).list(u);
    const ms = Date.now() - t0;
    expect(list).toHaveLength(50);
    expect(list.reduce((n, r) => n + r.items.reduce((m, i) => m + i.sets.length, 0), 0)).toBe(30_000);
    expect(seen).toHaveLength(2); // amended by 09.3 AC30: the sweep probe, then the one list statement
    expect(ms).toBeLessThan(LIST_BOUND_MS);
  });
});
